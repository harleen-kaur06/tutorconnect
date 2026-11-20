import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { CalendarDays, Users, BookOpen, ClipboardCheck, LogOut, Plus, ExternalLink, Upload, MessageSquare, Clock, GraduationCap, ShieldCheck, FileText, ArrowRight, CheckCircle2 } from 'lucide-react'
import './style.css'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = url && key ? createClient(url, key) : null
const demo = !supabase
const sample = {
  classes: [{id:'c1',title:'Grade 6 Mathematics',starts_at:new Date(Date.now()+86400000).toISOString(),meet_url:'https://meet.google.com/',student_name:'Harleen'}],
  homework: [{id:'h1',title:'Fractions practice',description:'Complete questions 1–10 and upload a photo or PDF.',due_date:new Date(Date.now()+3*86400000).toISOString().slice(0,10),file_url:'',status:'published'}],
  submissions: []
}
const ALLOWED_EXT=['pdf','doc','docx','jpg','jpeg','png']
const FILE_ACCEPT='.pdf,.doc,.docx,.jpg,.jpeg,.png'
const MAX_FILE_MB=10
function validateFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase()
  if(!ALLOWED_EXT.includes(ext)) return 'Only PDF, DOC, DOCX, JPG and PNG files are allowed.'
  if(file.size>MAX_FILE_MB*1024*1024) return `File is too large. Maximum size is ${MAX_FILE_MB} MB.`
  return ''
}
const safeName=(n)=>n.replace(/[^A-Za-z0-9._-]+/g,'_')
async function fnErrorMessage(error,data){
  if(data?.error) return data.error
  try{ const body=await error?.context?.json?.(); if(body?.error) return body.error }catch{}
  return error?.message || 'Request failed.'
}
function App(){
  const [page,setPage]=useState(()=>window.location.hash.replace(/^#\/?/, '') || 'home')
  const navigate=(next)=>{ window.location.hash = next === 'home' ? '/' : `/${next}`; setPage(next) }
  useEffect(()=>{
    const syncPage=()=>setPage(window.location.hash.replace(/^#\/?/, '') || 'home')
    window.addEventListener('hashchange',syncPage)
    return ()=>window.removeEventListener('hashchange',syncPage)
  },[])
  const [session,setSession]=useState(null), [profile,setProfile]=useState(null)
  const [tab,setTab]=useState('overview')
  const [classes,setClasses]=useState([]), [homework,setHomework]=useState([]), [subs,setSubs]=useState([])
  const [students,setStudents]=useState([]), [busy,setBusy]=useState(false), [notice,setNotice]=useState('')
  const [showClass,setShowClass]=useState(false), [showHw,setShowHw]=useState(false)
  const [email,setEmail]=useState(''), [password,setPassword]=useState('')
  const [classForm,setClassForm]=useState({title:'',starts_at:'',student_email:'',duration_minutes:'60'})
  const [hwForm,setHwForm]=useState({title:'',description:'',due_date:'',student_email:''}), [hwFile,setHwFile]=useState(null), [hwFileError,setHwFileError]=useState('')
  const [feedback,setFeedback]=useState({}), [hwFilter,setHwFilter]=useState('all'), [subFilter,setSubFilter]=useState('all')
  const [uploading,setUploading]=useState(false)
  const [calendarConnected,setCalendarConnected]=useState(false), [calendarEmail,setCalendarEmail]=useState('')
  const [connectingCalendar,setConnectingCalendar]=useState(false)
  const displayRole=profile?.role || (demo ? 'tutor' : 'student')

  useEffect(()=>{ if(!supabase){setClasses(sample.classes);setHomework(sample.homework);return}
    supabase.auth.getSession().then(({data})=>setSession(data.session))
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>subscription.unsubscribe()
  },[])
  useEffect(()=>{ if(session){ loadData(); loadCalendarStatus() } },[session])
  useEffect(()=>{ if(!supabase||!session) return
    const tick=()=>{ if(document.visibilityState==='visible') loadData() }
    const id=setInterval(tick,30000)
    window.addEventListener('focus',tick)
    return ()=>{ clearInterval(id); window.removeEventListener('focus',tick) }
  },[session])

  useEffect(()=>{
    const params = new URLSearchParams(window.location.search)
    const status = params.get('google_calendar')
    if(status === 'connected') setNotice('Google Calendar connected successfully.')
    if(status === 'error') setNotice(`Google Calendar connection failed: ${params.get('message') || 'Please try again.'}`)
    if(status) {
      params.delete('google_calendar'); params.delete('message')
      const query = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
    }
  },[])

  async function loadCalendarStatus(){
    if(!supabase || !session) return
    const {data,error}=await supabase.functions.invoke('google-calendar-status')
    if(!error && data){setCalendarConnected(!!data.connected);setCalendarEmail(data.google_email||'')}
  }

  async function connectGoogleCalendar(){
    if(!supabase) return
    setConnectingCalendar(true)
    const {data,error}=await supabase.functions.invoke('google-auth-start')
    setConnectingCalendar(false)
    if(error || !data?.url){setNotice(await fnErrorMessage(error,data));return}
    window.location.assign(data.url)
  }
  async function loadData(){
    const {data:p}=await supabase.from('profiles').select('*').eq('id',session.user.id).single()
    setProfile(p)
    const {data:c}=await supabase.from('classes').select('*, profiles:student_id(full_name,email)').order('starts_at')
    const {data:h}=await supabase.from('homework').select('*, profiles:student_id(full_name,email)').order('created_at',{ascending:false})
    const {data:s}=await supabase.from('submissions').select('*, homework(title), profiles:student_id(full_name,email)').order('submitted_at',{ascending:false})
    setClasses(c||[])
    const hwWithLinks = await Promise.all((h||[]).map(async item => { if (!item.file_url) return item; const {data:link}=await supabase.storage.from('homework-files').createSignedUrl(item.file_url, 3600); return {...item, file_url: link?.signedUrl || ''} }))
    setHomework(hwWithLinks);
    const withLinks = await Promise.all((s||[]).map(async item => { if (!item.file_url) return {...item, file_url: ''}; const {data:link}=await supabase.storage.from('homework-files').createSignedUrl(item.file_url, 3600); return {...item, file_url:link?.signedUrl || ''} }))
    setSubs(withLinks)
    if(p?.role==='tutor'){
      const {data:st}=await supabase.from('profiles').select('*').eq('role','student')
      setStudents(st||[])
    }
  }
  async function auth(action){
    if(!supabase){setNotice('Demo mode: connect Supabase to enable real accounts and shared data.');return}
    setBusy(true)
    const result=action==='signup'
      ? await supabase.auth.signUp({email,password,options:{emailRedirectTo:`${window.location.origin}${import.meta.env.BASE_URL}`}})
      : await supabase.auth.signInWithPassword({email,password})
    setBusy(false)
    setNotice(result.error?.message || (action==='signup'?'Student account created. Check your email for confirmation.':'Signed in successfully.'))
  }
  async function signOut(){if(supabase) await supabase.auth.signOut();setSession(null);setProfile(null)}
  async function addClass(e){
    e.preventDefault()
    if(!supabase){setClasses([...classes,{...classForm,id:crypto.randomUUID(),starts_at:new Date(classForm.starts_at).toISOString(),meet_url:'https://meet.google.com/',student_name:'Demo student'}]);setShowClass(false);setNotice('Demo class added.');return}
    if(!calendarConnected){setNotice('Connect Google Calendar before scheduling a class.');return}
    setBusy(true)
    const {data,error}=await supabase.functions.invoke('create-class',{body:{
      title:classForm.title,
      starts_at:new Date(classForm.starts_at).toISOString(),
      student_email:classForm.student_email,
      duration_minutes:Number(classForm.duration_minutes)||60
    }})
    setBusy(false)
    if(error || data?.error){setNotice(await fnErrorMessage(error,data));return}
    setNotice(data?.message || 'Class scheduled.')
    setShowClass(false)
    setClassForm({title:'',starts_at:'',student_email:'',duration_minutes:'60'})
    await loadData()
  }
  function closeHw(){setShowHw(false);setHwForm({title:'',description:'',due_date:'',student_email:''});setHwFile(null);setHwFileError('')}
  async function addHomework(e){
    e.preventDefault()
    if(hwFile){const problem=validateFile(hwFile); if(problem){setHwFileError(problem);return}}
    if(!supabase){setHomework([...homework,{...hwForm,id:crypto.randomUUID(),status:'published',file_url:''}]);closeHw();setNotice('Demo homework published.');return}
    if(!hwForm.student_email){setNotice('Select a student.');return}
    setBusy(true)
    const {data:student}=await supabase.from('profiles').select('id').eq('email',hwForm.student_email).single()
    if(!student){setBusy(false);setNotice('Student not found. Ask the student to create an account first.');return}
    let failure=''
    if(hwFile){
      // File is saved to the tutor's Google Drive by the upload-file Edge Function, which also creates the homework row.
      const fd=new FormData()
      fd.append('kind','homework'); fd.append('file',hwFile); fd.append('student_id',student.id)
      fd.append('title',hwForm.title); fd.append('description',hwForm.description); fd.append('due_date',hwForm.due_date||'')
      const {data,error}=await supabase.functions.invoke('upload-file',{body:fd})
      if(error||data?.error){setBusy(false);setHwFileError(await fnErrorMessage(error,data));return}
    }else{
      const {error}=await supabase.from('homework').insert({title:hwForm.title,description:hwForm.description,due_date:hwForm.due_date||null,student_id:student.id,tutor_id:session.user.id})
      failure=error?.message||''
    }
    setBusy(false)
    setNotice(failure||'Homework published.')
    if(!failure) closeHw()
    loadData()
  }
  async function submitWork(hw,file){
    if(!supabase){setNotice('Demo mode: connect Supabase to submit files across devices.');return}
    if(!file)return
    const problem=validateFile(file)
    if(problem){setNotice(problem);return}
    setUploading(true)
    const fd=new FormData()
    fd.append('kind','submission'); fd.append('homework_id',hw.id); fd.append('file',file)
    const {data,error}=await supabase.functions.invoke('upload-file',{body:fd})
    setUploading(false)
    if(error||data?.error){setNotice(await fnErrorMessage(error,data));return}
    setNotice('Homework submitted.')
    loadData()
  }
  async function openDriveFile(kind,id,name,mime){
    const inline=/pdf|image/.test(mime||'')
    const w=inline?window.open('','_blank'):null
    setNotice('Opening file…')
    const {data,error}=await supabase.functions.invoke('download-file',{body:{kind,id}})
    if(error||!(data instanceof Blob)){ if(w)w.close(); setNotice(await fnErrorMessage(error,data)); return }
    const url=URL.createObjectURL(new Blob([data],{type:mime||'application/octet-stream'}))
    if(w){ w.location.href=url } else { const a=document.createElement('a'); a.href=url; a.download=name||'file'; a.click() }
    setNotice('')
    setTimeout(()=>URL.revokeObjectURL(url),60000)
  }
  async function saveFeedback(s){
    if(!supabase){setNotice('Feedback saved in demo preview only.');return}
    if(s.reviewed_at){setNotice('This submission was already reviewed and cannot be changed.');return}
    if(!(feedback[s.id]||'').trim()){setNotice('Write your feedback before sending.');return}
    if(!window.confirm('Send this feedback? It cannot be changed afterwards.')) return
    const {error}=await supabase.from('submissions').update({feedback:feedback[s.id].trim(),reviewed_at:new Date().toISOString()}).eq('id',s.id).is('reviewed_at',null)
    setNotice(error?.message||'Feedback sent to student.');loadData()
  }
  const isTutor=displayRole==='tutor'
  const submittedIds=new Set(subs.map(x=>x.homework_id))
  const subFor=(id)=>subs.find(x=>x.homework_id===id)
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),60000);return ()=>clearInterval(id)},[])
  const upcoming=classes.filter(c=>classEnd(c)>now)
  const pastClasses=classes.filter(c=>classEnd(c)<=now).reverse()
  const nav=[['overview','Overview',BookOpen],['classes','Classes',CalendarDays],['homework','Homework',ClipboardCheck],...(isTutor?[['students','Students',Users],['reviews','Submissions',MessageSquare]]:[])]
  if(page !== 'portal') return <MarketingPage page={page} navigate={navigate}/>
  if(!session && !demo) return <main className="auth"><section className="authcard"><div className="brand"><GraduationCap/> Harleen Tutoring Portal</div><h1>Learning, connected.</h1><p className="muted">Sign in or create your tutoring account.</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="At least 8 characters"/></label><div className="actions"><button onClick={()=>auth('signin')} disabled={busy}>Sign in</button><button className="secondary" onClick={()=>auth('signup')} disabled={busy}>Create account</button></div>{notice&&<p className="notice">{notice}</p>}</section></main>
  return <div className="app"><aside className="sidebar"><div className="brand"><GraduationCap/> Harleen Tutoring Portal</div><div className="workspace">{isTutor?'Tutor workspace':'Student workspace'}</div><button className="public-site-link" onClick={()=>navigate('home')}>Visit public website <ExternalLink size={14}/></button><nav>{nav.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={18}/>{label}</button>)}</nav><div className="sidebottom"><span className="avatar">{isTutor?'T':'S'}</span><div><b>{profile?.full_name|| (demo?'Demo Tutor':session?.user?.email||'Student')}</b><small>{displayRole}</small></div>{!demo&&<button className="iconbtn" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={17}/></button>}</div></aside>
  <main className="main"><header><div><div className="eyebrow">YOUR LEARNING SPACE</div><h1>{nav.find(n=>n[0]===tab)?.[1]||'Overview'}</h1></div><div className="header-right"><span className="pill">{demo?'Preview mode':'Connected'}</span>{!demo&&<button className="secondary" onClick={loadData}>Refresh</button>}{!demo&&<button className="secondary" onClick={signOut}><LogOut size={16}/> Sign out</button>}{isTutor&&<><button className="secondary" onClick={connectGoogleCalendar} disabled={connectingCalendar}>{connectingCalendar?'Connecting…':calendarConnected?`Google connected${calendarEmail?' · '+calendarEmail:''}`:'Connect Google Calendar'}</button><button onClick={()=>setShowClass(true)}><Plus size={17}/> Schedule class</button></>}</div></header>
  {notice&&<div className="notice" onClick={()=>setNotice('')}>{notice} <span>×</span></div>}
  {tab==='overview'&&<><section className="welcome"><div><p className="eyebrow light">WELCOME TO HARLEEN TUTORING PORTAL</p><h2>{isTutor?'Make every lesson count.':'Your next learning step starts here.'}</h2><p>{isTutor?'Keep classes, assignments and student progress in one simple place.':'Find your classes, complete homework and get feedback from your tutor.'}</p></div><GraduationCap size={74}/></section><div className="stats"><Stat label="Upcoming classes" value={upcoming.length} icon={<CalendarDays/>}/><Stat label="Homework" value={homework.length} icon={<ClipboardCheck/>}/><Stat label={isTutor?'Submissions to review':'Feedback received'} value={isTutor?subs.filter(s=>!s.reviewed_at).length:subs.filter(s=>s.reviewed_at).length} icon={<MessageSquare/>}/></div><div className="sectionhead"><h2>Coming up</h2><button className="textbtn" onClick={()=>setTab('classes')}>View all</button></div><ClassList classes={upcoming.slice(0,3)} now={now}/></>}
  {tab==='classes'&&<><div className="sectionhead"><h2>{isTutor?'Scheduled sessions':'Your sessions'}</h2>{isTutor&&<button onClick={()=>setShowClass(true)}><Plus size={16}/> New class</button>}</div><ClassList classes={upcoming} now={now}/>{pastClasses.length>0&&<><div className="sectionhead"><h2>Past classes</h2></div><ClassList classes={pastClasses} now={now}/></>}</>}
  {tab==='homework'&&<><div className="sectionhead"><h2>{isTutor?'Assignments shared':'Your assignments'}</h2>{isTutor&&<button onClick={()=>setShowHw(true)}><Plus size={16}/> Create homework</button>}</div>
  <Chips value={hwFilter} onChange={setHwFilter} options={[['all','All'],['pending','Pending'],['submitted','Submitted'],['reviewed','Reviewed']]}/>
  {(()=>{const rows=homework.filter(hw=>{const sub=subFor(hw.id);const st=sub?.reviewed_at?'reviewed':sub?'submitted':'pending';return hwFilter==='all'||hwFilter===st})
  return rows.length?<div className="tablewrap"><table className="dtable"><thead><tr><th>Homework</th>{isTutor&&<th>Student</th>}<th>Due</th><th>Status</th><th>Attachment</th><th>{isTutor?'Submission':'Your work'}</th>{!isTutor&&<th>Feedback</th>}</tr></thead><tbody>
  {rows.map(hw=>{const sub=subFor(hw.id);const reviewed=!!sub?.reviewed_at
  return <tr key={hw.id}>
    <td><b>{hw.title}</b>{hw.description&&<small>{hw.description}</small>}</td>
    {isTutor&&<td>{hw.profiles?.full_name||hw.profiles?.email||'—'}</td>}
    <td>{sub?'—':(hw.due_date||'No deadline')}</td>
    <td><span className={`tag${sub?' done':''}`}>{reviewed?'REVIEWED':sub?'SUBMITTED':'PENDING'}</span></td>
    <td>{hw.drive_file_id?<button className="secondary" onClick={()=>openDriveFile('homework',hw.id,hw.file_name,hw.file_mime)}>Open <ExternalLink size={13}/></button>:hw.file_url?<a href={hw.file_url} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a>:'—'}</td>
    <td>{sub?.drive_file_id&&<button className="secondary" onClick={()=>openDriveFile('submission',sub.id,sub.file_name,sub.file_mime)}>View file <ExternalLink size={13}/></button>}
      {!isTutor&&reviewed&&<small className="lockednote">Reviewed · locked</small>}
      {!isTutor&&!reviewed&&<label className="upload"><Upload size={14}/>{uploading?'Uploading…':sub?'Replace':'Upload'}<input type="file" accept={FILE_ACCEPT} onChange={e=>{const f=e.target.files?.[0];e.target.value='';submitWork(hw,f)}}/></label>}
      {isTutor&&!sub&&'—'}</td>
    {!isTutor&&<td>{sub?.feedback||'—'}</td>}
  </tr>})}
  </tbody></table></div>:<Empty text="No homework to show."/>})()}</>}
  {tab==='students'&&<><div className="sectionhead"><h2>Your students</h2></div><div className="card">{students.length?students.map(s=><div className="studentrow" key={s.id}><span className="avatar">S</span><div><b>{s.full_name||'Student'}</b><p>{s.email}</p></div></div>):<Empty text="Students appear here after they create an account."/>}</div></>}
  {tab==='reviews'&&<><div className="sectionhead"><h2>Student submissions</h2></div>
  <Chips value={subFilter} onChange={setSubFilter} options={[['all','All'],['pending','Needs review'],['done','Reviewed']]}/>
  {(()=>{const latest=subs.filter((x,i)=>subs.findIndex(y=>y.homework_id===x.homework_id)===i).filter(x=>subFilter==='all'||(subFilter==='done')===!!x.reviewed_at).sort((a,b)=>(!!a.reviewed_at)-(!!b.reviewed_at))
  return latest.length?<div className="tablewrap"><table className="dtable"><thead><tr><th>Student</th><th>Homework</th><th>Submitted</th><th>File</th><th>Status</th><th>Feedback</th></tr></thead><tbody>
  {latest.map(x=><tr key={x.id}>
    <td>{x.profiles?.full_name||x.profiles?.email||'Student'}</td>
    <td><b>{x.homework?.title||'Homework'}</b></td>
    <td>{new Date(x.submitted_at).toLocaleDateString()}</td>
    <td>{x.drive_file_id?<button className="secondary" onClick={()=>openDriveFile('submission',x.id,x.file_name,x.file_mime)}>View file <ExternalLink size={13}/></button>:x.file_url?<a href={x.file_url} target="_blank" rel="noreferrer">View file</a>:'—'}</td>
    <td><span className={`tag${x.reviewed_at?' done':''}`}>{x.reviewed_at?'REVIEWED':'NEEDS REVIEW'}</span></td>
    <td>{x.reviewed_at?<><span>{x.feedback}</span><small className="lockednote">Sent {new Date(x.reviewed_at).toLocaleDateString()} · locked</small></>:<><textarea placeholder="Write feedback…" value={feedback[x.id]??''} onChange={e=>setFeedback({...feedback,[x.id]:e.target.value})}/><button onClick={()=>saveFeedback(x)}>Send feedback</button></>}</td>
  </tr>)}
  </tbody></table></div>:<Empty text="No submissions to show."/>})()}</>}
  </main>
  {showClass&&<Modal title="Schedule a class" close={()=>setShowClass(false)}><form onSubmit={addClass}><label>Class title<input required value={classForm.title} onChange={e=>setClassForm({...classForm,title:e.target.value})} placeholder="e.g. Grade 6 Mathematics"/></label><label>Date and time<input required type="datetime-local" min={new Date().toISOString().slice(0,16)} value={classForm.starts_at} onChange={e=>setClassForm({...classForm,starts_at:e.target.value})}/></label>{!demo&&<label>Student<select required value={classForm.student_email} onChange={e=>setClassForm({...classForm,student_email:e.target.value})}><option value="">{students.length?'Select a student…':'No students registered yet'}</option>{students.map(st=><option key={st.id} value={st.email}>{st.full_name?`${st.full_name} (${st.email})`:st.email}</option>)}</select></label>}<label>Lesson duration<select value={classForm.duration_minutes} onChange={e=>setClassForm({...classForm,duration_minutes:e.target.value})}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></select></label><p className="hint">A Google Calendar event and a unique Google Meet link will be created automatically. The student will receive a calendar invitation by email.</p><button type="submit" disabled={busy || (!demo && !calendarConnected)}>{busy?'Creating…':'Create class & Meet link'}</button>{!demo&&!calendarConnected&&<p className="hint">Connect Google Calendar using the button at the top of the dashboard first.</p>}</form></Modal>}
  {showHw&&<Modal title="Create homework" close={closeHw}><form onSubmit={addHomework}><label>Assignment title<input required value={hwForm.title} onChange={e=>setHwForm({...hwForm,title:e.target.value})} placeholder="e.g. Fractions worksheet"/></label><label>Instructions<textarea required value={hwForm.description} onChange={e=>setHwForm({...hwForm,description:e.target.value})} placeholder="Explain what the student needs to complete…"/></label><label>Due date<input type="date" value={hwForm.due_date} onChange={e=>setHwForm({...hwForm,due_date:e.target.value})}/></label>{!demo&&<label>Student<select required value={hwForm.student_email} onChange={e=>setHwForm({...hwForm,student_email:e.target.value})}><option value="">{students.length?'Select a student…':'No students registered yet'}</option>{students.map(st=><option key={st.id} value={st.email}>{st.full_name?`${st.full_name} (${st.email})`:st.email}</option>)}</select></label>}<label>Attach a file (optional)<input type="file" accept={FILE_ACCEPT} onChange={e=>{const f=e.target.files?.[0]||null;if(f){const p=validateFile(f);if(p){setHwFileError(p);setHwFile(null);e.target.value='';return}}setHwFileError('');setHwFile(f)}}/></label><p className="hint">PDF, DOC, DOCX, JPG or PNG · max 10 MB · saved to your Google Drive{hwFile?` · Selected: ${hwFile.name}`:''}</p>{hwFileError&&<p className="hint" style={{color:'#b3261e'}}>{hwFileError}</p>}<button type="submit" disabled={busy}>{busy?'Publishing…':'Publish homework'}</button></form></Modal>}
  </div>
}

function MarketingPage({page,navigate}){
  const privacy=page==='privacy', terms=page==='terms', legal=privacy||terms
  return <div className="public-site">
    <header className="public-nav">
      <button className="public-brand" onClick={()=>navigate('home')}><span className="brand-mark"><GraduationCap size={23}/></span><span>Harleen Tutoring Portal</span></button>
      <nav className="public-links">
        <button onClick={()=>navigate('home')}>Home</button>
        <button onClick={()=>navigate('privacy')}>Privacy</button>
        <button onClick={()=>navigate('terms')}>Terms</button>
      </nav>
      <button className="portal-button" onClick={()=>navigate('portal')}>Login to Portal <ArrowRight size={16}/></button>
    </header>
    {!legal ? <main>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="kicker-dot"></span> A simpler way to stay connected</span>
          <h1>Great learning happens when everyone is <span>in sync.</span></h1>
          <p className="hero-description">Harleen Tutoring Portal brings tutors and students together with a shared space for lessons, assignments, submissions and feedback.</p>
          <div className="hero-actions"><button className="portal-button hero-cta" onClick={()=>navigate('portal')}>Login to Portal <ArrowRight size={17}/></button><button className="learn-button" onClick={()=>document.getElementById('how-it-works')?.scrollIntoView({behavior:'smooth'})}>See how it works</button></div>
          <div className="hero-proof"><CheckCircle2 size={16}/> One organized place for your learning journey</div>
        </div>
        <div className="hero-visual">
          <div className="visual-orbit orbit-one"></div><div className="visual-orbit orbit-two"></div>
          <div className="visual-card main-visual-card">
            <div className="visual-card-head"><span className="visual-dot"></span><span>YOUR LEARNING SPACE</span><span className="visual-menu">•••</span></div>
            <div className="visual-welcome">Welcome back!</div><div className="visual-subtitle">Your next steps, all in one place.</div>
            <div className="visual-stat-row"><div className="visual-stat"><CalendarDays/><b>Classes</b><small>Stay on schedule</small></div><div className="visual-stat"><BookOpen/><b>Homework</b><small>Keep learning</small></div></div>
            <div className="visual-task"><span className="task-icon"><ClipboardCheck size={17}/></span><span><b>Learning progress</b><small>Assignments and feedback</small></span><CheckCircle2 className="task-check"/></div>
          </div>
          <div className="floating-note note-top"><span className="note-icon"><Users size={17}/></span><span><b>Connected learning</b><small>Tutor + student</small></span></div>
          <div className="floating-note note-bottom"><span className="note-icon note-purple"><MessageSquare size={17}/></span><span><b>Helpful feedback</b><small>Keep improving</small></span></div>
        </div>
      </section>
      <section className="feature-section" id="features">
        <div className="section-intro"><span className="section-kicker">MADE FOR LEARNING</span><h2>Everything you need to keep lessons moving.</h2><p>Simple tools help tutors organize their teaching and help students know what comes next.</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-icon blue"><CalendarDays/></span><h3>Class scheduling</h3><p>Keep upcoming sessions and lesson details easy to find in one shared portal.</p></article>
          <article className="feature-card"><span className="feature-icon violet"><ClipboardCheck/></span><h3>Homework sharing</h3><p>Share assignments and due dates so students can stay focused between lessons.</p></article>
          <article className="feature-card"><span className="feature-icon teal"><Upload/></span><h3>Work submissions</h3><p>Students can submit completed work for their tutor to review.</p></article>
          <article className="feature-card"><span className="feature-icon amber"><MessageSquare/></span><h3>Personal feedback</h3><p>Keep tutor feedback connected to the work it is about.</p></article>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="section-intro"><span className="section-kicker">HOW IT WORKS</span><h2>A clear path from lesson to progress.</h2></div>
        <div className="steps-grid"><div className="step"><span>01</span><h3>Sign in</h3><p>Access your Harleen Tutoring Portal account through the secure portal.</p></div><div className="step"><span>02</span><h3>Stay organized</h3><p>View classes, assignments and learning updates in one place.</p></div><div className="step"><span>03</span><h3>Keep progressing</h3><p>Submit work, receive feedback and prepare for the next lesson.</p></div></div>
        <div className="bottom-cta"><div><span className="section-kicker">READY WHEN YOU ARE</span><h2>Your learning space is just a click away.</h2></div><button className="portal-button" onClick={()=>navigate('portal')}>Login to Portal <ArrowRight size={16}/></button></div>
      </section>
    </main> : <main className="legal-main">
      <div className="legal-heading"><span className="section-kicker">HARLEEN TUTORING PORTAL</span><h1>{privacy?'Privacy Policy':'Terms of Service'}</h1><p>{privacy?'How information is handled when you use Harleen Tutoring Portal.':'The basic terms for accessing and using the Harleen Tutoring Portal platform.'}</p><small>Last updated: November 20, 2026 · Draft for review</small></div>
      {privacy?<PrivacyContent/>:<TermsContent/>}
      <div className="legal-callout"><ShieldCheck size={22}/><p><b>Questions about this document?</b><br/>Contact the Harleen Tutoring Portal operator using the support contact provided to you when you registered. Replace this instruction with a monitored support email before public launch.</p></div>
      <button className="portal-button legal-login" onClick={()=>navigate('portal')}>Login to Portal <ArrowRight size={16}/></button>
    </main>}
    <footer className="public-footer"><div className="footer-top"><button className="public-brand footer-brand" onClick={()=>navigate('home')}><span className="brand-mark"><GraduationCap size={22}/></span><span>Harleen Tutoring Portal</span></button><p>Helping tutors and students stay connected.</p><button className="footer-login" onClick={()=>navigate('portal')}>Login to Portal <ArrowRight size={15}/></button></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Harleen Tutoring Portal. All rights reserved.</span><div><button onClick={()=>navigate('privacy')}>Privacy Policy</button><button onClick={()=>navigate('terms')}>Terms of Service</button></div></div></footer>
  </div>
}

function PrivacyContent(){return <article className="legal-content">
  <p className="legal-notice">This is a starter policy based on the features visible in the current Harleen Tutoring Portal application. The operator must confirm actual data flows, hosting arrangements, Google OAuth scopes, retention periods and contact details before publishing it as a final policy.</p>
  <h2>1. About this policy</h2><p>This Privacy Policy explains how Harleen Tutoring Portal (“we”, “us” or “the platform”) may collect, use, disclose and protect information when tutors and students use the website and learning portal.</p>
  <h2>2. Information we handle</h2><p>Depending on how you use the platform, information may include:</p><ul><li>Account email and authentication information managed through Supabase.</li><li>Profile information such as name and account role (tutor or student).</li><li>Learning information such as class titles, scheduled dates, tutor-student associations, homework instructions, due dates and feedback.</li><li>Files uploaded as homework submissions and related file references.</li><li>Information associated with Google Calendar integration, if you choose to connect a Google account.</li><li>Basic technical information that may be recorded by the website host or service providers.</li></ul>
  <h2>3. How information is used</h2><p>Information is used to create and manage accounts, display the appropriate portal, organize lessons, share assignments, receive submitted work, provide feedback, support Google Calendar features, maintain platform security and respond to support requests.</p>
  <h2>4. Google Calendar and Drive</h2><p>Homework files uploaded through the platform are stored in the tutor’s Google Drive and made available only to the tutor and the student concerned through the portal.</p><p>If you connect Google Calendar, Google may ask you to authorize the permissions displayed during consent. Google information should be used only for the features and purposes described at authorization, such as calendar scheduling or meeting functions. You can review or revoke third-party access in your Google Account settings. This section must be checked against the exact OAuth scopes and token-handling implementation before launch.</p>
  <h2>5. Service providers and sharing</h2><p>Information may be processed by providers supporting the platform, including Supabase for authentication and the database, Google Drive (the tutor’s account) for homework files, Google for services you authorize, and the website hosting provider. Relevant learning information may be visible to the tutor or student involved in that tutoring relationship. The operator must confirm its actual practices and applicable legal obligations.</p>
  <h2>6. Security and retention</h2><p>The platform uses service providers and measures intended to protect information, but no online service can guarantee absolute security. The operator should define and publish specific retention, backup and deletion procedures before public launch.</p>
  <h2>7. Your choices and requests</h2><p>You may request access to, correction of or deletion of personal information by contacting the Harleen Tutoring Portal operator. Some information may need to be retained where required by law or for legitimate recordkeeping. You can choose not to connect Google Calendar, although calendar-related features may then be unavailable.</p>
  <h2>8. Children and student accounts</h2><p>Where school-age students use Harleen Tutoring Portal, a parent or legal guardian should review the service and provide any consent required by applicable law. Users should avoid entering unnecessary sensitive information about a student. The operator must establish age-appropriate account, consent and safeguarding practices before accepting accounts from minors.</p>
  <h2>9. Changes and contact</h2><p>We may update this policy as the platform changes. The updated version will be posted here with a revised date. Before launch, add the responsible legal entity or individual and a real, monitored contact method.</p>
</article>}

function TermsContent(){return <article className="legal-content">
  <p className="legal-notice">This is a general starter template, not legal advice. The Harleen Tutoring Portal operator must review it, identify the service provider, set fees and cancellation rules, and obtain appropriate legal advice before relying on it.</p>
  <h2>1. Agreement and eligibility</h2><p>These Terms apply to access to and use of Harleen Tutoring Portal. By using the platform, you agree to these terms. If you are under the age of majority where you live, a parent or legal guardian must review and agree to the terms on your behalf where required by law.</p>
  <h2>2. What Harleen Tutoring Portal provides</h2><p>Harleen Tutoring Portal provides online tools that may help tutors and students organize class schedules, share homework, submit completed work and exchange feedback. Features may change over time. Harleen Tutoring Portal is a coordination tool and does not guarantee educational outcomes.</p>
  <h2>3. Accounts and responsibilities</h2><ul><li>Provide accurate account information and keep sign-in credentials confidential.</li><li>Use only your assigned account and promptly report suspected unauthorized access.</li><li>Do not impersonate another person, access another user’s information or interfere with the platform.</li><li>Tutors are responsible for appropriate permission to add students and share learning materials.</li><li>Students and guardians must submit only materials they are permitted to share.</li></ul>
  <h2>4. Tutoring arrangements</h2><p>Fees, refunds, cancellations, rescheduling, attendance and tutoring communications are arrangements between the tutor and student or parent/guardian, unless the operator states otherwise in a separate written agreement. Harleen Tutoring Portal does not guarantee a tutor’s qualifications, availability or suitability unless explicitly stated.</p>
  <h2>5. User content</h2><p>You remain responsible for content you submit, including homework files and learning materials. You must have the rights and permissions needed to upload it. You allow the operator to host, store, display and process that content as reasonably necessary to provide the platform.</p>
  <h2>6. Acceptable use</h2><p>You must not use Harleen Tutoring Portal for unlawful, harmful, harassing, fraudulent or misleading activity; upload malicious code; bypass access controls; disrupt the service; or misuse another person’s personal information. Access may be restricted where reasonably necessary to protect users or the service.</p>
  <h2>7. Third-party services</h2><p>Harleen Tutoring Portal may rely on services such as Supabase, Google Calendar and website hosting providers. Those services may have their own terms and privacy policies. Dependent features may be affected by third-party availability or changes.</p>
  <h2>8. Availability and disclaimers</h2><p>The platform is provided on an “as available” basis. To the extent permitted by applicable law, the operator does not warrant uninterrupted or error-free operation or guarantee a particular learning result. Nothing here limits rights that cannot legally be excluded.</p>
  <h2>9. Suspension and termination</h2><p>You may stop using the platform at any time. The operator may suspend or terminate access for a breach of these terms, security concerns or discontinuation of the service, subject to applicable law. The operator should provide a clear account-closure and data-handling process.</p>
  <h2>10. Changes and governing law</h2><p>These terms may be updated by posting a revised version. The operator must specify the governing jurisdiction and dispute process before launch. If a provision is unenforceable, the remaining provisions continue to apply to the extent permitted by law.</p>
  <h2>11. Contact</h2><p>For questions, contact the Harleen Tutoring Portal operator using the support contact provided when you registered. Add a real, monitored support email and the operator’s legal name here before public launch.</p>
</article>}

function Chips({value,onChange,options}){return <div className="chips">{options.map(([id,label])=><button key={id} className={value===id?'active':''} onClick={()=>onChange(id)}>{label}</button>)}</div>}
const classEnd=(c)=>new Date(c.starts_at).getTime()+(Number(c.duration_minutes)||60)*60000
function Stat({label,value,icon}){return <div className="stat"><div className="staticon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>}
function ClassList({classes,now=Date.now()}){return <div className="cards">{classes.map(c=>{const ended=classEnd(c)<=now,live=!ended&&new Date(c.starts_at).getTime()<=now;return <article className={`card classcard${ended?' ended':''}`} key={c.id}><div className="datebox"><b>{new Date(c.starts_at).toLocaleDateString(undefined,{day:'2-digit'})}</b><span>{new Date(c.starts_at).toLocaleDateString(undefined,{month:'short'})}</span></div><div className="classinfo"><h3>{c.title}</h3><p><Clock size={14}/> {new Date(c.starts_at).toLocaleString()}</p>{c.profiles?.full_name&&<p>{c.profiles.full_name}</p>}</div>{ended?<span className="tag done">COMPLETED</span>:c.meet_url?<>{live&&<span className="tag done">LIVE NOW</span>}<a className="join" href={c.meet_url} target="_blank" rel="noreferrer">Join Meet <ExternalLink size={14}/></a></>:c.meeting_status==='pending'?<span className="muted small">Meet link is being generated…</span>:null}</article>})}{!classes.length&&<Empty text="No classes scheduled yet."/>}</div>}
function Empty({text}){return <div className="empty"><CalendarDays size={28}/><p>{text}</p></div>}
function Modal({title,close,children}){return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><section className="modal"><div className="modalhead"><h2>{title}</h2><button className="iconbtn" onClick={close}>×</button></div>{children}</section></div>}
createRoot(document.getElementById('root')).render(<App/>)
