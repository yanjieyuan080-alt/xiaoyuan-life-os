
const allowedOrigin = 'https://yanjieyuan080-alt.github.io';
function headers(req: Request) {
  return {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': req.headers.get('Origin') === allowedOrigin ? allowedOrigin : '',
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'GET, OPTIONS',
    'Vary':'Origin',
    'Cache-Control':'no-store'
  };
}
function response(req: Request, body: unknown, status=200) {
  return new Response(JSON.stringify(body),{status,headers:headers(req)});
}
async function upstream(path: string, params: Record<string,string>) {
  const url=new URL('https://music.163.com'+path);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if (!res.ok) throw new Error('音乐源暂不可用（'+res.status+'）');
  const data=await res.json();
  if(data.code!==undefined && Number(data.code)!==200) throw new Error('音乐源返回异常（'+data.code+'）');
  return data;
}
Deno.serve(async(req: Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:headers(req)});
  if(req.method!=='GET') return response(req,{message:'Method not allowed'},405);
  const url=new URL(req.url),path=url.pathname.replace(/^.*\/life-os-music/,'')||'/';
  try{
    // This fixed diagnostic exposes only public catalogue availability.
    // The gateway still verifies the project JWT before invoking the function.
    if(path==='/health'){
      const [s,p]=await Promise.all([
        upstream('/api/search/get',{s:'逆光',type:'1',limit:'3'}),
        upstream('/api/song/enhance/player/url',{ids:'[478507889]',br:'128000'})
      ]);
      return response(req,{ok:true,search_results:(s.result?.songs||[]).length,playback_available:!!p.data?.[0]?.url});
    }
    const auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))return response(req,{message:'请登录后使用音乐搜索'},401);
    const check=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{
      headers:{Authorization:auth,apikey:Deno.env.get('SUPABASE_ANON_KEY')||''},signal:AbortSignal.timeout(8000)
    });
    if(!check.ok)return response(req,{message:'登录状态已过期，请重新登录'},401);
    if(path==='/search'){
      const q=(url.searchParams.get('keywords')||'').trim();
      if(!q||q.length>120)return response(req,{message:'请输入120字以内的歌曲名或歌手名'},400);
      const limit=Math.min(20,Math.max(1,Number(url.searchParams.get('limit'))||20));
      return response(req,await upstream('/api/search/get',{s:q,type:'1',limit:String(limit)}));
    }
    if(path==='/song/detail'){
      const ids=(url.searchParams.get('ids')||'').split(',');
      if(!ids.length||ids.length>20||ids.some(id=>!/^\d{1,15}$/.test(id)))return response(req,{message:'歌曲编号无效'},400);
      return response(req,await upstream('/api/song/detail',{ids:JSON.stringify(ids.map(Number))}));
    }
    if(path==='/song/url'){
      const id=url.searchParams.get('id')||'';
      if(!/^\d{1,15}$/.test(id))return response(req,{message:'歌曲编号无效'},400);
      return response(req,await upstream('/api/song/enhance/player/url',{ids:JSON.stringify([Number(id)]),br:'128000'}));
    }
    return response(req,{message:'Not found'},404);
  }catch(e){
    console.error('Music upstream failure',e instanceof Error ? e.message : 'unknown');
    return response(req,{message:e instanceof Error&&e.name==='TimeoutError'?'音乐源响应超时，请稍后重试':'音乐源暂不可用，请稍后重试'},502);
  }
});
