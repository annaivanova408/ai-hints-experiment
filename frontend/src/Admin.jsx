import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Database, Download, Leaf, LockKeyhole, LogOut, RefreshCw, Search, Trash2, X } from "lucide-react";
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

const CONDITION_LABELS = {AI: "ИИ-помощник", EXPERT: "Эксперт", CONTROL: "Без комментария"};

function Verdict({item}) {
  if (!item.answered) return <span className="verdict verdict-skip">Не отвечал</span>;
  if (item.timeout) return <span className="verdict verdict-wrong">Не успел</span>;
  return item.is_correct
    ? <span className="verdict verdict-right"><Check size={14}/>Верно</span>
    : <span className="verdict verdict-wrong"><X size={14}/>Неверно</span>;
}

function AnswerTable({items, showCondition = true}) {
  return <table className="detail-table"><thead><tr><th>Вопрос</th>{showCondition && <th>Комментарий</th>}<th>Ответ участника</th><th>Правильный</th><th>Итог</th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}>
      <td><strong>{item.id}</strong><small>{item.stem}</small></td>
      {showCondition && <td>{CONDITION_LABELS[item.condition] || item.condition || "-"}</td>}
      <td>{item.selected ? <>{item.selected}. {item.selected_text}</> : "-"}{item.satisfaction ? <small>Оценка комментария: {item.satisfaction} из 5</small> : null}</td>
      <td>{item.correct}. {item.correct_text}</td>
      <td><Verdict item={item}/></td>
    </tr>)}
  </tbody></table>;
}

function SubjectDetail({detail, loading, error, onClose}) {
  const session = detail?.session;
  const totals = detail?.totals;
  return <div className="detail-overlay" role="dialog" aria-modal="true" onClick={onClose}>
    <section className="detail-panel" onClick={event => event.stopPropagation()}>
      <header className="detail-header">
        <div><div className="eyebrow">Участник</div><h2>{session?.subject_id || "..."}</h2>{session && <p>{session.sex}, {session.age} лет, {session.education}</p>}</div>
        <button className="secondary icon-command" title="Закрыть" onClick={onClose}><X/></button>
      </header>
      {loading && <p className="detail-empty">Загрузка...</p>}
      {error && <div className="error">{error}</div>}
      {detail && <>
        <div className="detail-stats">
          <div><span>Вопросы по фрагментам</span><strong>{totals.segments_answered} из {totals.segments}</strong><small>верно: {totals.segments_correct}</small></div>
          <div><span>Итоговый тест</span><strong>{totals.final_answered} из {totals.final}</strong><small>верно: {totals.final_correct}</small></div>
          <div><span>Порядок видео</span><strong>{session.assignment.video_order.join(", ")}</strong></div>
        </div>
        <h3>Вопросы по фрагментам</h3>
        <AnswerTable items={detail.segments}/>
        <h3>Итоговый тест</h3>
        <AnswerTable items={detail.final}/>
        <h3>Оценки и шкалы</h3>
        <table className="detail-table"><tbody>
          {detail.video_ratings.map(rating => <tr key={rating.video_id}><td>Лёгкость усвоения: {rating.video_id} (показано {rating.position}-м)</td><td>{rating.value ?? "-"}</td></tr>)}
          {detail.manipulation.map(item => <tr key={item.key}><td>{item.title}</td><td>{item.value ?? "-"}</td></tr>)}
          {detail.nasa.map(item => <tr key={item.key}><td>{item.title} <small>{CONDITION_LABELS[item.condition] || item.condition}</small></td><td>{item.value ?? "-"}</td></tr>)}
          {!detail.video_ratings.length && !detail.nasa.length && !detail.manipulation.length && <tr><td colSpan="2">Пока ничего не заполнено</td></tr>}
        </tbody></table>
      </>}
    </section>
  </div>;
}

function DeleteConfirm({subjectId, busy, error, onCancel, onConfirm}) {
  return <div className="detail-overlay" role="dialog" aria-modal="true" onClick={busy ? undefined : onCancel}>
    <section className="confirm-panel" onClick={event => event.stopPropagation()}>
      <h2>Удалить участника {subjectId}?</h2>
      <p>Будут удалены его сессия, все ответы и события. Отменить это нельзя. Если данные могут пригодиться, сначала выгрузите ZIP.</p>
      {error && <div className="error">{error}</div>}
      <div className="confirm-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="danger" onClick={onConfirm} disabled={busy}><Trash2 size={18}/>{busy ? "Удаление..." : "Удалить"}</button>
      </div>
    </section>
  </div>;
}

export default function Admin() {
  const [token,setToken]=useState(()=>sessionStorage.getItem(TOKEN_KEY));
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [downloading,setDownloading]=useState("");
  const [detailFor,setDetailFor]=useState("");
  const [detail,setDetail]=useState(null);
  const [detailError,setDetailError]=useState("");
  const [deleteFor,setDeleteFor]=useState("");
  const [deleting,setDeleting]=useState(false);
  const [deleteError,setDeleteError]=useState("");
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
  const openDetail=async subjectId=>{
    setDetailFor(subjectId);setDetail(null);setDetailError("");
    try{setDetail(await api.adminSessionDetail(token,subjectId));}
    catch(err){if(err.message.includes("администратора"))logout();else setDetailError(err.message);}
  };
  const confirmDelete=async()=>{
    setDeleting(true);setDeleteError("");
    try{
      await api.adminDeleteSession(token,deleteFor);
      if(detailFor===deleteFor){setDetailFor("");setDetail(null);}
      setDeleteFor("");
      await load();
    }catch(err){if(err.message.includes("администратора"))logout();else setDeleteError(err.message);}
    finally{setDeleting(false);}
  };
  const download=async(path,name,key)=>{setDownloading(key);setError("");try{await downloadAdminExport(path,token,name);}catch(err){if(err.message.includes("истекла"))logout();else setError(err.message);}finally{setDownloading("");}};
  if(!token)return <AdminLogin onLogin={setToken}/>;
  return <main className="admin-page"><header className="admin-header"><div className="brand"><Leaf size={27}/> research<span>.lab</span></div><div className="admin-actions"><button className="secondary icon-command" title="Обновить" onClick={load} disabled={loading}><RefreshCw className={loading?"spin":""}/></button><button className="secondary" onClick={logout}><LogOut size={18}/>Выйти</button></div></header><section className="admin-title"><div><div className="eyebrow">Исследование</div><h1>Результаты участников</h1><p>Данные обновляются автоматически каждые 10 секунд.</p></div><button className="primary" disabled={!rows.length||downloading==="all"} onClick={()=>download("/api/admin/export.zip","experiment.zip","all")}><Download size={19}/>{downloading==="all"?"Подготовка...":"Выгрузить все"}</button></section>{error&&<div className="error admin-error">{error}</div>}<section className="admin-stats"><div><span>Участники</span><strong>{rows.length}</strong></div><div><span>Завершили</span><strong>{totals.completed}</strong></div><div><span>События</span><strong>{totals.events}</strong></div><div><span>Результаты</span><strong>{totals.records}</strong></div></section><section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>Участник</th><th>Этап</th><th>Статус</th><th>Активность</th><th>Данные</th><th></th></tr></thead><tbody>{rows.map(row=><tr key={row.subject_id}><td><strong>{row.subject_id}</strong></td><td>{row.sex}, {row.age}<small>{row.education}</small></td><td>{row.status==="completed"?"Завершено":PHASES[row.state?.phase]||"Регистрация"}</td><td><span className={`status status-${row.status}`}>{row.status==="completed"?"Завершен":"Проходит"}</span></td><td>{formatDate(row.updated_at)}</td><td>{row.event_count} событий<small>{row.record_count} результатов</small></td><td><div className="row-actions"><button className="secondary row-download" onClick={()=>openDetail(row.subject_id)} title={`Открыть ответы ${row.subject_id}`}><Search size={18}/><span>Ответы</span></button><button className="secondary row-download" disabled={downloading===row.subject_id} onClick={()=>download(`/api/admin/sessions/${encodeURIComponent(row.subject_id)}/export.zip`,`${row.subject_id}.zip`,row.subject_id)} title={`Выгрузить данные ${row.subject_id}`}><Download size={18}/><span>{downloading===row.subject_id?"...":"ZIP"}</span></button><button className="secondary row-download row-delete" onClick={()=>{setDeleteFor(row.subject_id);setDeleteError("");}} title={`Удалить ${row.subject_id}`}><Trash2 size={18}/></button></div></td></tr>)}{!rows.length&&!loading&&<tr><td colSpan="7" className="empty-table"><Database/>Пока нет участников</td></tr>}</tbody></table></section>{detailFor&&<SubjectDetail detail={detail} loading={!detail&&!detailError} error={detailError} onClose={()=>{setDetailFor("");setDetail(null);setDetailError("");}}/>}{deleteFor&&<DeleteConfirm subjectId={deleteFor} busy={deleting} error={deleteError} onCancel={()=>{setDeleteFor("");setDeleteError("");}} onConfirm={confirmDelete}/>}</main>;
}
