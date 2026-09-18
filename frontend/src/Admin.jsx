import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Download, Leaf, LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import { api, downloadAdminExport } from "./api";

const TOKEN_KEY = "research_admin_token";
const PHASES = {
  task_instruction: "Инструкция",
  practice_intro: "Перед тренировкой",
  practice: "Тренировка",
  calibration: "Калибровка",
  drift: "Проверка оборудования",
  video: "Просмотр видео",
  learnability: "Оценка видео",
  final_intro: "Перед итоговым тестом",
  final: "Итоговый тест",
  nasa: "Оценка нагрузки",
  manipulation: "Завершающие вопросы",
  debrief: "Завершение",
};

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", {dateStyle:"short",timeStyle:"short"}).format(new Date(value));
}

function AdminLogin({onLogin}) {
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async event=>{
    event.preventDefault();setError("");setLoading(true);
    try{const result=await api.adminLogin(password);sessionStorage.setItem(TOKEN_KEY,result.token);onLogin(result.token);}
    catch(err){setError(err.message);}
    finally{setLoading(false);}
  };
  return <main className="admin-login"><header className="brand"><Leaf size={27}/> research<span>.lab</span></header><section className="admin-login-panel"><div className="admin-lock"><LockKeyhole/></div><h1>Панель администратора</h1><p>Введите пароль для доступа к результатам исследования.</p><form onSubmit={submit}><label>Пароль<input autoFocus type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password"/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={!password||loading}>{loading?"Вход...":"Войти"}</button></form></section></main>;
}

export default function Admin() {
  const [token,setToken]=useState(()=>sessionStorage.getItem(TOKEN_KEY));
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [downloading,setDownloading]=useState("");
  const logout=useCallback(()=>{sessionStorage.removeItem(TOKEN_KEY);setToken(null);setRows([]);},[]);
  const load=useCallback(async()=>{
    if(!token)return;
    setLoading(true);setError("");
    try{setRows(await api.adminSessions(token));}
    catch(err){if(err.message.includes("администратора"))logout();else setError(err.message);}
    finally{setLoading(false);}
  },[token,logout]);
  useEffect(()=>{load();if(!token)return undefined;const timer=setInterval(load,10000);return()=>clearInterval(timer);},[load,token]);
  const totals=useMemo(()=>({completed:rows.filter(row=>row.status==="completed").length,events:rows.reduce((sum,row)=>sum+row.event_count,0),records:rows.reduce((sum,row)=>sum+row.record_count,0)}),[rows]);
  const download=async(path,name,key)=>{setDownloading(key);setError("");try{await downloadAdminExport(path,token,name);}catch(err){if(err.message.includes("истекла"))logout();else setError(err.message);}finally{setDownloading("");}};
  if(!token)return <AdminLogin onLogin={setToken}/>;
  return <main className="admin-page"><header className="admin-header"><div className="brand"><Leaf size={27}/> research<span>.lab</span></div><div className="admin-actions"><button className="secondary icon-command" title="Обновить" onClick={load} disabled={loading}><RefreshCw className={loading?"spin":""}/></button><button className="secondary" onClick={logout}><LogOut size={18}/>Выйти</button></div></header><section className="admin-title"><div><div className="eyebrow">Исследование</div><h1>Результаты участников</h1><p>Данные обновляются автоматически каждые 10 секунд.</p></div><button className="primary" disabled={!rows.length||downloading==="all"} onClick={()=>download("/api/admin/export.zip","experiment.zip","all")}><Download size={19}/>{downloading==="all"?"Подготовка...":"Выгрузить все"}</button></section>{error&&<div className="error admin-error">{error}</div>}<section className="admin-stats"><div><span>Участники</span><strong>{rows.length}</strong></div><div><span>Завершили</span><strong>{totals.completed}</strong></div><div><span>События</span><strong>{totals.events}</strong></div><div><span>Результаты</span><strong>{totals.records}</strong></div></section><section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>Участник</th><th>Этап</th><th>Статус</th><th>Активность</th><th>Данные</th><th></th></tr></thead><tbody>{rows.map(row=><tr key={row.subject_id}><td><strong>{row.subject_id}</strong></td><td>{row.sex}, {row.age}<small>{row.education}</small></td><td>{row.status==="completed"?"Завершено":PHASES[row.state?.phase]||"Регистрация"}</td><td><span className={`status status-${row.status}`}>{row.status==="completed"?"Завершен":"Проходит"}</span></td><td>{formatDate(row.updated_at)}</td><td>{row.event_count} событий<small>{row.record_count} результатов</small></td><td><button className="secondary row-download" disabled={downloading===row.subject_id} onClick={()=>download(`/api/admin/sessions/${encodeURIComponent(row.subject_id)}/export.zip`,`${row.subject_id}.zip`,row.subject_id)} title={`Выгрузить данные ${row.subject_id}`}><Download size={18}/><span>{downloading===row.subject_id?"...":"ZIP"}</span></button></td></tr>)}{!rows.length&&!loading&&<tr><td colSpan="7" className="empty-table"><Database/>Пока нет участников</td></tr>}</tbody></table></section></main>;
}
