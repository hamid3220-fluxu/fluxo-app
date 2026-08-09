import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type, apikey'};
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const token=request.headers.get('Authorization'); if(!token)throw new Error('Unauthorized');
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,site=Deno.env.get('SITE_URL')!;
    const caller=createClient(url,anon,{global:{headers:{Authorization:token}}}),admin=createClient(url,service,{auth:{persistSession:false}});
    const{data:{user}}=await caller.auth.getUser(); if(!user)throw new Error('Unauthorized');
    const{email,role}=await request.json(); if(!/^\S+@\S+\.\S+$/.test(email)||!['admin','lawyer','staff'].includes(role))throw new Error('Invalid invitation');
    const{data:profile}=await admin.from('profiles').select('organization_id,role,status').eq('id',user.id).single();
    if(!profile||profile.status!=='active'||!['admin','administrator'].includes(String(profile.role).toLowerCase()))throw new Error('Admin access required');
    const{data:invitation,error:insertError}=await admin.from('team_invitations').insert({organization_id:profile.organization_id,email:email.toLowerCase(),role,invited_by:user.id}).select('id').single(); if(insertError)throw insertError;
    const{data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:site,data:{organization_id:profile.organization_id,role,team_invitation_id:invitation.id}});
    if(inviteError){await admin.from('team_invitations').update({status:'revoked'}).eq('id',invitation.id);throw inviteError;}
    if(invited.user){const{error:profileError}=await admin.from('profiles').upsert({id:invited.user.id,organization_id:profile.organization_id,email:email.toLowerCase(),full_name:email.split('@')[0],role,status:'active'},{onConflict:'id'});if(profileError)throw profileError;}
    return new Response(JSON.stringify({ok:true}),{headers:{...cors,'Content-Type':'application/json'}});
  }catch(error){return new Response(JSON.stringify({error:error instanceof Error?error.message:'Invitation failed'}),{status:400,headers:{...cors,'Content-Type':'application/json'}});}
});
