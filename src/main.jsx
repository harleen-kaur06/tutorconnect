import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { CalendarDays, Users, BookOpen, ClipboardCheck, LogOut, Plus, ExternalLink, Upload, MessageSquare, Clock, GraduationCap, Menu } from 'lucide-react'
import './style.css'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = url && key ? createClient(url, key) : null
const demo = !supabase
const sample = {
  classes: [{id:'c1',title:'Grade 6 Mathematics',starts_at:new Date(Date.now()+86400000).toISOString(),meet_url:'https://meet.google.com/',student_name:'Aarav'}],
  homework: [{id:'h1',title:'Fractions practice',description:'Complete questions 1–10 and upload a photo or PDF.',due_date:new Date(Date.now()+3*86400000).toISOString().slice(0,10),file_url:'',status:'published'}],
  submissions: []
}
function App(){
  const [session,setSession]=useState(null), [profile,setProfile]=useState(null)
  const [role,setRole]=useState('tutor'), [tab,setTab]=useState('overview')
  const [classes,setClasses]=useState([]), [homework,setHomework]=useState([]), [subs,setSubs]=useState([])
  const [students,setStudents]=useState([]), [busy,setBusy]=useState(false), [notice,setNotice]=useState('')
  const [showClass,setShowClass]=useState(false), [showHw,setShowHw]=useState(false)
  const [email,setEmail]=useState(''), [password,setPassword]=useState('')
  const [classForm,setClassForm]=useState({title:'',starts_at:'',meet_url:'',student_email:''})
  const [hwForm,setHwForm]=useState({title:'',description:'',due_date:'',student_email:''})
  const [feedback,setFeedback]=useState({})
  const [uploading,setUploading]=useState(false)
  const displayRole=profile?.role || role

  useEffect(()=>{ if(!supabase){setClasses(sample.classes);setHomework(sample.homework);return}
    supabase.auth.getSession().then(({data})=>setSession(data.session))
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>subscription.unsubscribe()
  },[])
  useEffect(()=>{ if(session) loadData() },[session])
  async function loadData(){
    const {data:p}=await supabase.from('profiles').select('*').eq('id',session.user.id).single()
    setProfile(p)
    const {data:c}=await supabase.from('classes').select('*, profiles:student_id(full_name,email)').order('starts_at')
    const {data:h}=await supabase.from('homework').select('*, profiles:student_id(full_name,email)').order('created_at',{ascending:false})
    const {data:s}=await supabase.from('submissions').select('*, homework(title), profiles:student_id(full_name,email)').order('submitted_at',{ascending:false})
    setClasses(c||[]);setHomework(h||[]);
    const withLinks = await Promise.all((s||[]).map(async item => { const {data:link}=await supabase.storage.from('homework-files').createSignedUrl(item.file_url, 3600); return {...item, file_url:link?.signedUrl || ''} }))
    setSubs(withLinks)
    if(p?.role==='tutor'){
      const {data:st}=await supabase.from('profiles').select('*').eq('role','student')
      setStudents(st||[])
    }
  }
  async function auth(action) {
  if (!supabase) {
    setNotice('Demo mode: connect Supabase to enable real accounts and shared data.');
    return;
  }

  setBusy(true);

  const result = action === 'signup'
    ? await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role },
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`
        }
      })
    : await supabase.auth.signInWithPassword({
        email,
        password
      });

  setBusy(false);

  setNotice(
    result.error?.message ||
    (action === 'signup'
      ? 'Account created. Check your email for confirmation.'
      : 'Signed in successfully.')
  );
}
  async function signOut(){if(supabase) await supabase.auth.signOut();setSession(null);setProfile(null)}
  async function addClass(e){
    e.preventDefault()
    if(!supabase){setClasses([...classes,{...classForm,id:crypto.randomUUID(),student_name:'Demo student'}]);setShowClass(false);setNotice('Demo class added.');return}
    const {data:student}=await supabase.from('profiles').select('id').eq('email',classForm.student_email).single()
    if(!student){setNotice('Student email not found. Ask the student to create an account first.');return}
    const {error}=await supabase.from('classes').insert({title:classForm.title,starts_at:new Date(classForm.starts_at).toISOString(),meet_url:classForm.meet_url,student_id:student.id,tutor_id:session.user.id})
    setNotice(error?.message||'Class scheduled.');setShowClass(false);loadData()
  }
  async function addHomework(e){
    e.preventDefault()
    if(!supabase){setHomework([...homework,{...hwForm,id:crypto.randomUUID(),status:'published'}]);setShowHw(false);setNotice('Demo homework published.');return}
    const {data:student}=await supabase.from('profiles').select('id').eq('email',hwForm.student_email).single()
    if(!student){setNotice('Student email not found. Ask the student to create an account first.');return}
    const {error}=await supabase.from('homework').insert({title:hwForm.title,description:hwForm.description,due_date:hwForm.due_date,student_id:student.id,tutor_id:session.user.id})
    setNotice(error?.message||'Homework published.');setShowHw(false);loadData()
  }
  async function submitWork(hw,file){
    if(!supabase){setNotice('Demo mode: connect Supabase to submit files across devices.');return}
    if(!file)return
    setUploading(true)
    const path=`${session.user.id}/${Date.now()}-${file.name}`
    const {error:upErr}=await supabase.storage.from('homework-files').upload(path,file)
    if(!upErr){
      const {error}=await supabase.from('submissions').insert({homework_id:hw.id,student_id:session.user.id,file_url:path})
      setNotice(error?.message||'Homework submitted.')}
    else setNotice(upErr.message)
    setUploading(false);loadData()
  }
  async function saveFeedback(s){
    if(!supabase){setNotice('Feedback saved in demo preview only.');return}
    const {error}=await supabase.from('submissions').update({feedback:feedback[s.id]||'',reviewed_at:new Date().toISOString()}).eq('id',s.id)
    setNotice(error?.message||'Feedback sent to student.');loadData()
  }
  const isTutor=displayRole==='tutor'
  const upcoming=classes.filter(c=>new Date(c.starts_at)>new Date())
  const nav=[['overview','Overview',BookOpen],['classes','Classes',CalendarDays],['homework','Homework',ClipboardCheck],...(isTutor?[['students','Students',Users],['reviews','Submissions',MessageSquare]]:[])]
  if(!session && !demo) return <main className="auth"><section className="authcard"><div className="brand"><GraduationCap/> TutorConnect</div><h1>Learning, connected.</h1><p className="muted">Sign in or create your tutoring account.</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="At least 8 characters"/></label><div className="actions"><button onClick={()=>auth('signin')} disabled={busy}>Sign in</button><button className="secondary" onClick={()=>auth('signup')} disabled={busy}>Create account</button></div>{notice&&<p className="notice">{notice}</p>}</section></main>
  return <div className="app"><aside className="sidebar"><div className="brand"><GraduationCap/> TutorConnect</div><div className="workspace">{isTutor?'Tutor workspace':'Student workspace'}</div><nav>{nav.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={18}/>{label}</button>)}</nav><div className="sidebottom"><span className="avatar">{isTutor?'T':'S'}</span><div><b>{profile?.full_name|| (demo?'Demo Tutor':session?.user?.email||'Student')}</b><small>{displayRole}</small></div>{!demo&&<button className="iconbtn" onClick={signOut}><LogOut size={17}/></button>}</div></aside>
  <main className="main"><header><div><div className="eyebrow">YOUR LEARNING SPACE</div><h1>{nav.find(n=>n[0]===tab)?.[1]||'Overview'}</h1></div><div className="header-right"><span className="pill">{demo?'Preview mode':'Connected'}</span>{isTutor&&<button onClick={()=>setShowClass(true)}><Plus size={17}/> Schedule class</button>}</div></header>
  {notice&&<div className="notice" onClick={()=>setNotice('')}>{notice} <span>×</span></div>}
  {tab==='overview'&&<><section className="welcome"><div><p className="eyebrow light">WELCOME TO TUTORCONNECT</p><h2>{isTutor?'Make every lesson count.':'Your next learning step starts here.'}</h2><p>{isTutor?'Keep classes, assignments and student progress in one simple place.':'Find your classes, complete homework and get feedback from your tutor.'}</p></div><GraduationCap size={74}/></section><div className="stats"><Stat label="Upcoming classes" value={upcoming.length} icon={<CalendarDays/>}/><Stat label="Homework" value={homework.length} icon={<ClipboardCheck/>}/><Stat label={isTutor?'Submissions to review':'Feedback received'} value={isTutor?subs.filter(s=>!s.reviewed_at).length:subs.filter(s=>s.reviewed_at).length} icon={<MessageSquare/>}/></div><div className="sectionhead"><h2>Coming up</h2><button className="textbtn" onClick={()=>setTab('classes')}>View all</button></div><ClassList classes={upcoming.slice(0,3)}/></>}
  {tab==='classes'&&<><div className="sectionhead"><h2>{isTutor?'Scheduled sessions':'Your sessions'}</h2>{isTutor&&<button onClick={()=>setShowClass(true)}><Plus size={16}/> New class</button>}</div><ClassList classes={classes}/></>}
  {tab==='homework'&&<><div className="sectionhead"><h2>{isTutor?'Assignments shared':'Your assignments'}</h2>{isTutor&&<button onClick={()=>setShowHw(true)}><Plus size={16}/> Create homework</button>}</div><div className="cards">{homework.map(hw=><article className="card" key={hw.id}><div className="cardtop"><span className="tag">ASSIGNMENT</span><span className="muted small">Due {hw.due_date||'No deadline'}</span></div><h3>{hw.title}</h3><p>{hw.description}</p>{hw.file_url&&<a href={hw.file_url} target="_blank" rel="noreferrer">Open attached resource <ExternalLink size={14}/></a>}{!isTutor&&<label className="upload"> <Upload size={16}/>{uploading?'Uploading…':'Upload completed work'}<input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={e=>submitWork(hw,e.target.files?.[0])}/></label>}</article>)}</div></>}
  {tab==='students'&&<><div className="sectionhead"><h2>Your students</h2></div><div className="card">{students.length?students.map(s=><div className="studentrow" key={s.id}><span className="avatar">S</span><div><b>{s.full_name||'Student'}</b><p>{s.email}</p></div></div>):<Empty text="Students appear here after they create an account."/ >}</div></>}
  {tab==='reviews'&&<><div className="sectionhead"><h2>Student submissions</h2></div><div className="cards">{subs.map(s=><article className="card" key={s.id}><span className="tag">{s.reviewed_at?'REVIEWED':'NEEDS REVIEW'}</span><h3>{s.homework?.title||'Homework submission'}</h3><p>{s.profiles?.full_name||s.profiles?.email||'Student'} · {new Date(s.submitted_at).toLocaleDateString()}</p><a href={s.file_url} target="_blank" rel="noreferrer">View submitted file <ExternalLink size={14}/></a><textarea placeholder="Write feedback for the student…" value={feedback[s.id]??s.feedback??''} onChange={e=>setFeedback({...feedback,[s.id]:e.target.value})}/><button onClick={()=>saveFeedback(s)}>Send feedback</button></article>)}{!subs.length&&<Empty text="No submissions yet. They will appear here when students upload work."/ >}</div></>}
  </main>
  {showClass&&<Modal title="Schedule a class" close={()=>setShowClass(false)}><form onSubmit={addClass}><label>Class title<input required value={classForm.title} onChange={e=>setClassForm({...classForm,title:e.target.value})} placeholder="e.g. Grade 6 Mathematics"/></label><label>Date and time<input required type="datetime-local" value={classForm.starts_at} onChange={e=>setClassForm({...classForm,starts_at:e.target.value})}/></label><label>Google Meet link<input required type="url" value={classForm.meet_url} onChange={e=>setClassForm({...classForm,meet_url:e.target.value})} placeholder="https://meet.google.com/…"/></label>{!demo&&<label>Student email<input required type="email" value={classForm.student_email} onChange={e=>setClassForm({...classForm,student_email:e.target.value})}/></label>}<p className="hint">Create the meeting in Google Calendar, copy its Google Meet link, and paste it here. The portal will share it with the student.</p><button type="submit">Save class</button></form></Modal>}
  {showHw&&<Modal title="Create homework" close={()=>setShowHw(false)}><form onSubmit={addHomework}><label>Assignment title<input required value={hwForm.title} onChange={e=>setHwForm({...hwForm,title:e.target.value})} placeholder="e.g. Fractions worksheet"/></label><label>Instructions<textarea required value={hwForm.description} onChange={e=>setHwForm({...hwForm,description:e.target.value})} placeholder="Explain what the student needs to complete…"/></label><label>Due date<input type="date" value={hwForm.due_date} onChange={e=>setHwForm({...hwForm,due_date:e.target.value})}/></label>{!demo&&<label>Student email<input required type="email" value={hwForm.student_email} onChange={e=>setHwForm({...hwForm,student_email:e.target.value})}/></label>}<button type="submit">Publish homework</button></form></Modal>}
  </div>
}
function Stat({label,value,icon}){return <div className="stat"><div className="staticon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>}
function ClassList({classes}){return <div className="cards">{classes.map(c=><article className="card classcard" key={c.id}><div className="datebox"><b>{new Date(c.starts_at).toLocaleDateString(undefined,{day:'2-digit'})}</b><span>{new Date(c.starts_at).toLocaleDateString(undefined,{month:'short'})}</span></div><div className="classinfo"><h3>{c.title}</h3><p><Clock size={14}/> {new Date(c.starts_at).toLocaleString()}</p>{c.profiles?.full_name&&<p>{c.profiles.full_name}</p>}</div>{c.meet_url&&<a className="join" href={c.meet_url} target="_blank" rel="noreferrer">Join Meet <ExternalLink size={14}/></a>}</article>)}{!classes.length&&<Empty text="No classes scheduled yet."/ >}</div>}
function Empty({text}){return <div className="empty"><CalendarDays size={28}/><p>{text}</p></div>}
function Modal({title,close,children}){return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><section className="modal"><div className="modalhead"><h2>{title}</h2><button className="iconbtn" onClick={close}>×</button></div>{children}</section></div>}
createRoot(document.getElementById('root')).render(<App/>)
