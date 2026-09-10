import { useEffect, useState } from "react";
import { ArrowRight, Download, Leaf } from "lucide-react";
import { api } from "./api";
import Experiment from "./Experiment";
import Anxiety from "./Anxiety";

const demo = new URLSearchParams(location.search).get("demo") === "1";

function Shell({children, compact = false}) {
  return <main className={compact ? "experiment-shell" : "shell"}>{!compact && <header className="brand"><Leaf size={27}/> research<span>.lab</span></header>}{children}</main>;
}

function Setup({onStart}) {
  const [form, setForm] = useState({subject_id: "", sex: "", age: "", education: "", consent_confirmed: false});
  const [error, setError] = useState("");
  const submit = async e => {
    e.preventDefault(); setError("");
    try { onStart(await api.start({...form, age: Number(form.age)})); } catch (err) { setError(err.message); }
  };
  return <section className="panel setup"><div className="eyebrow">Экспериментальная сессия</div><h1>Регистрация участника</h1><p className="lead">Экран заполняет исследователь перед передачей компьютера участнику.</p><form onSubmit={submit} className="form-grid">
    <label>ID участника<input required value={form.subject_id} onChange={e=>setForm({...form, subject_id:e.target.value})}/></label>
    <label>Пол<select required value={form.sex} onChange={e=>setForm({...form, sex:e.target.value})}><option value="">Выберите</option><option>Женский</option><option>Мужской</option><option>Другое</option></select></label>
    <label>Возраст<input required type="number" min="18" max="100" value={form.age} onChange={e=>setForm({...form, age:e.target.value})}/></label>
    <label>Образование<select required value={form.education} onChange={e=>setForm({...form, education:e.target.value})}><option value="">Выберите уровень</option><option>Среднее общее</option><option>Среднее профессиональное</option><option>Неоконченное высшее</option><option>Высшее - бакалавриат или специалитет</option><option>Магистратура</option><option>Аспирантура или ученая степень</option></select></label>
    <label className="check full"><input required type="checkbox" checked={form.consent_confirmed} onChange={e=>setForm({...form, consent_confirmed:e.target.checked})}/><span>Информированное согласие получено отдельно</span></label>
    {error && <div className="error full">{error}</div>}<button className="primary full" type="submit">Начать <ArrowRight size={20}/></button>
  </form></section>;
}

function Instructions({session, onContinue}) {
  const start = () => {
    document.documentElement.requestFullscreen().catch(() => {});
    onContinue();
  };
  return <section className="panel prose"><div className="eyebrow">ID {session.subject_id}</div><h1>Инструкция</h1><p>Вам предстоит посмотреть три коротких видео и ответить на вопросы по их содержанию.</p><p>После каждого смыслового фрагмента появится вопрос и единственная активная кнопка «Нужна подсказка». Подсказка предъявляется в каждом задании. После её просмотра и короткой паузы появятся варианты ответа.</p><div className="notice"><strong>Важно:</strong> отвечайте самостоятельно и старайтесь смотреть в центр экрана. Не переключайтесь между окнами во время прохождения.</div><p>Перед основной частью будут два тренировочных задания и калибровка оборудования.</p><button className="primary" onClick={start}>Перейти к тренировке <ArrowRight size={20}/></button></section>;
}

function Finish({session}) {
  const base = `/api/sessions/${encodeURIComponent(session.subject_id)}/export`;
  return <section className="panel prose center"><div className="success">Готово</div><h1>Спасибо за участие</h1><p>Сессия завершена, ответы и событийные метки сохранены.</p><div className="actions"><a className="secondary" href={`${base}/trials.csv`}><Download size={19}/> Пробы CSV</a><a className="secondary" href={`${base}/events.csv`}><Download size={19}/> Метки CSV</a><a className="secondary" href={`${base}/meta.json`}><Download size={19}/> Meta JSON</a><a className="secondary" href={`${base}/aoi_definitions.json`}><Download size={19}/> AOI JSON</a><a className="primary" href={`${base}/results.json`}><Download size={19}/> Все результаты</a></div></section>;
}

export default function App() {
  const [config, setConfig] = useState(null); const [session, setSession] = useState(null); const [error, setError] = useState("");
  useEffect(()=>{ api.config().then(setConfig).catch(e=>setError(e.message)); },[]);
  if (location.pathname === "/anxiety") return <Shell><Anxiety config={config}/></Shell>;
  if (error) return <Shell><div className="panel error">{error}</div></Shell>;
  if (!config) return <Shell><div className="panel">Загрузка...</div></Shell>;
  if (!session) return <Shell><Setup onStart={setSession}/></Shell>;
  const screen = session.state?.screen || "instructions";
  if (screen === "instructions") return <Shell><Instructions session={session} onContinue={async()=>{const state={screen:"experiment", phase:"practice", step:0}; await api.state(session.subject_id,state); setSession({...session,state});}}/></Shell>;
  if (screen === "completed") return <Shell><Finish session={session}/></Shell>;
  return <Shell compact><Experiment config={config} initialSession={session} demo={demo} onFinish={s=>setSession(s)}/></Shell>;
}
