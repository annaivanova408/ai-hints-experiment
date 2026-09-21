import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Leaf } from "lucide-react";
import { api } from "./api";
import Experiment from "./Experiment";
import Anxiety from "./Anxiety";
import Admin from "./Admin";

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
  return <section className="panel prose instructions-panel"><div className="instruction-progress"><i style={{width:"2%"}}/></div><div className="eyebrow">ID {session.subject_id}</div><h1>Общая инструкция</h1><p>Вам предстоит посмотреть 3 видео, разделённые на 27 смысловых фрагментов, и ответить на вопросы по их содержанию.</p><p>После каждого смыслового фрагмента появится вопрос и единственная активная кнопка «Далее». После нажатия будет показан обязательный комментарий. Затем появятся варианты ответа.</p><div className="notice instruction-rules"><strong>Во время прохождения:</strong><ul><li>Отвечайте самостоятельно.</li><li>Когда появится крестик, смотрите на него.</li><li>Не переключайтесь между окнами.</li></ul></div><p>Перед основной частью будут тренировочные задания и калибровка оборудования.</p><button className="primary" onClick={start}>Продолжить <ArrowRight size={20}/></button></section>;
}

const DEMO_SCREENS = [
  {label:"Общая инструкция", state:{screen:"instructions"}},
  {label:"Инструкция к заданию", state:{screen:"experiment",phase:"task_instruction"}},
  {label:"Перед тренировкой", state:{screen:"experiment",phase:"practice_intro"}},
  {label:"Тренировочное видео", state:{screen:"experiment",phase:"practice",step:0,trialStage:"clip"}},
  {label:"Вопрос тренировки", state:{screen:"experiment",phase:"practice",step:0,trialStage:"trial",demoTrialStage:"question"}},
  {label:"Ответ ИИ", state:{screen:"experiment",phase:"practice",step:0,trialStage:"trial",demoTrialStage:"hint"}},
  {label:"Ответ эксперта", state:{screen:"experiment",phase:"practice",step:1,trialStage:"trial",demoTrialStage:"hint"}},
  {label:"Калибровка", state:{screen:"experiment",phase:"calibration",videoPos:0}},
  {label:"Основное видео", state:{screen:"experiment",phase:"video",videoPos:0,clipPos:0,trialStage:"clip"}},
  {label:"Вопрос по фрагменту", state:{screen:"experiment",phase:"video",videoPos:0,clipPos:0,trialStage:"trial",demoTrialStage:"question"}},
  {label:"Оценка видео", state:{screen:"experiment",phase:"learnability",videoPos:0}},
  {label:"Итоговый тест", state:{screen:"experiment",phase:"final_intro"}},
  {label:"Оценка нагрузки", state:{screen:"experiment",phase:"nasa"}},
  {label:"Завершающие вопросы", state:{screen:"experiment",phase:"manipulation",manipulationPos:0}},
  {label:"Завершение", state:{screen:"experiment",phase:"debrief"}},
];

function DemoNavigator({session,onNavigate}) {
  const state=session.state||{};
  let index=DEMO_SCREENS.findIndex(item=>Object.entries(item.state).every(([key,value])=>state[key]===value));
  if(index<0)index=DEMO_SCREENS.findIndex(item=>item.state.screen===state.screen&&item.state.phase===state.phase);
  if(index<0)index=0;
  const go=next=>onNavigate(DEMO_SCREENS[Math.max(0,Math.min(DEMO_SCREENS.length-1,next))].state);
  return <aside className="demo-navigator"><strong>Демо</strong><button title="Предыдущий экран" aria-label="Предыдущий экран" disabled={index===0} onClick={()=>go(index-1)}><ChevronLeft/></button><select aria-label="Экран демонстрации" value={index} onChange={event=>go(Number(event.target.value))}>{DEMO_SCREENS.map((item,itemIndex)=><option key={item.label} value={itemIndex}>{item.label}</option>)}</select><button title="Следующий экран" aria-label="Следующий экран" disabled={index===DEMO_SCREENS.length-1} onClick={()=>go(index+1)}><ChevronRight/></button></aside>;
}

function Finish({session}) {
  return <section className="panel prose center instructions-panel"><div className="instruction-progress"><i style={{width:"100%"}}/></div><div className="success" aria-label="Готово"><Check size={30} strokeWidth={2.5}/></div><h1>Спасибо за участие!</h1><p>Исследование завершено.</p></section>;
}

export default function App() {
  const [config, setConfig] = useState(null); const [session, setSession] = useState(null); const [error, setError] = useState("");
  useEffect(()=>{ api.config().then(setConfig).catch(e=>setError(e.message)); },[]);
  if (location.pathname === "/admin") return <Admin/>;
  if (location.pathname === "/anxiety") return <Shell><Anxiety config={config}/></Shell>;
  if (error) return <Shell><div className="panel error">{error}</div></Shell>;
  if (!config) return <Shell><div className="panel">Загрузка...</div></Shell>;
  if (!session) return <Shell><Setup onStart={setSession}/></Shell>;
  const screen = session.state?.screen || "instructions";
  let content;
  if (screen === "instructions") content=<Shell><Instructions session={session} onContinue={async()=>{const state={screen:"experiment",phase:"task_instruction"};await api.state(session.subject_id,state);setSession({...session,state});}}/></Shell>;
  else if (screen === "completed") content=<Shell><Finish session={session}/></Shell>;
  else content=<Shell compact><Experiment key={demo?JSON.stringify(session.state):session.subject_id} config={config} initialSession={session} demo={demo} onFinish={s=>setSession(s)}/></Shell>;
  const navigate=async state=>{await api.state(session.subject_id,state);setSession({...session,state});};
  return <>{content}{demo&&screen!=="completed"&&<DemoNavigator session={session} onNavigate={navigate}/>}</>;
}
