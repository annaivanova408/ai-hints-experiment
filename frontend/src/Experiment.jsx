import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Lightbulb, Play, RotateCcw } from "lucide-react";
import { api } from "./api";

const LABELS = {AI: "Ответ ИИ-помощника", EXPERT: "Ответ эксперта", CONTROL: "Подсказка"};
const PRACTICE = [
  {id:"P1", stem:"Какой вариант лучше всего передает основную мысль короткого учебного фрагмента?", options:{A:"Первый вариант",B:"Второй вариант",C:"Третий вариант",D:"Четвертый вариант"}, correct:"B", hints:{ai:"Сначала выделите главную мысль, затем сравните с ней каждый вариант.",expert:"Попробуйте коротко пересказать главную мысль и найти наиболее близкий вариант.",control:"Внимательно перечитайте вопрос и выберите наиболее подходящий вариант."}},
  {id:"P2", stem:"Что важно сделать перед выбором ответа?", options:{A:"Ответить случайно",B:"Пропустить вопрос",C:"Сопоставить варианты с содержанием",D:"Закрыть страницу"}, correct:"C", hints:{ai:"Отделите то, что было сказано, от похожих, но отсутствовавших идей.",expert:"Сверьте каждый вариант с тем, что вы только что увидели или услышали.",control:"Подумайте над ответом самостоятельно и выберите один вариант."}},
];

function useDelay(ms, fn, deps=[]) {
  const callback=useRef(fn); callback.current=fn;
  useEffect(()=>{ if (ms == null) return; const id=setTimeout(()=>callback.current(),ms); return()=>clearTimeout(id); },[ms,...deps]);
}

function Scale({value,onChange,count=7,left="Совсем нет",right="Очень сильно"}) {
  return <div className="scale"><div className="scale-buttons">{Array.from({length:count},(_,i)=>i+1).map(n=><button key={n} className={value===n?"selected":""} onClick={()=>onChange(n)}>{n}</button>)}</div><div className="scale-labels"><span>{left}</span><span>{right}</span></div></div>;
}

function Frame({children, eyebrow, progress}) {
  return <div className="study-screen"><div className="study-top"><span>{eyebrow}</span>{progress && <span>{progress}</span>}</div><section className="study-card">{children}</section></div>;
}

function Fixation({ms,onDone,label="Смотрите в центр экрана"}) {
  useDelay(ms,onDone,[onDone]);
  return <Frame eyebrow="Короткая пауза"><div className="fixation" aria-label={label}>+</div></Frame>;
}

function HintTrial({item, condition, settings, demo, practice=false, optionOrder, onDone, emit, save}) {
  const [stage,setStage]=useState("question"); const [rating,setRating]=useState(null); const [choice,setChoice]=useState(null); const [canClose,setCanClose]=useState(false);
  const conditionKey=condition.toLowerCase();
  const duration=(name,value)=>demo?({hintMin:1200,hintMax:8000,rating:10000,recovery:1200,answer:30000}[name]):value;
  const enter = next => { setStage(next); };
  useEffect(()=>{ emit(32,"question_onset",{segment_id:item.id,condition}); },[item.id]);
  useDelay(stage==="hint"?duration("hintMin",settings.hint_min_ms):null,()=>setCanClose(true),[stage]);
  useDelay(stage==="hint"?duration("hintMax",settings.hint_max_ms):null,()=>{emit(35,"hint_offset",{segment_id:item.id,condition,payload:{automatic:true}});enter("rating")},[stage]);
  useDelay(stage==="rating"?duration("rating",settings.satisfaction_timeout_ms):null,async()=>{await save("hint_rating",item.id,{value:null,timeout:true,condition,practice});emit(41,"hint_rating_offset",{segment_id:item.id,condition,payload:{timeout:true}});enter("recovery")},[stage]);
  useDelay(stage==="recovery"?duration("recovery",settings.recovery_ms):null,()=>enter("answer"),[stage]);
  useDelay(stage==="answer"?duration("answer",settings.probe_timeout_ms):null,async()=>{await save("segment_answer",item.id,{selected:null,correct:item.correct,is_correct:false,timeout:true,condition,practice});emit(51,"answer",{segment_id:item.id,condition,payload:{timeout:true}});onDone()},[stage]);

  if(stage==="question") return <Frame eyebrow={practice?"Тренировочное задание":"Вопрос по фрагменту"}><div className="question-only"><h2>{item.stem}</h2><button className="primary" onClick={()=>{emit(33,"hint_request",{segment_id:item.id,condition});emit(34,"hint_onset",{segment_id:item.id,condition});enter("hint")}}><Lightbulb size={20}/> Нужна подсказка</button></div></Frame>;
  if(stage==="hint") return <Frame eyebrow={LABELS[condition]}><div className="hint-content"><h2>{LABELS[condition]}</h2><p>{item.hints[conditionKey]}</p><button className="primary" disabled={!canClose} onClick={()=>{emit(35,"hint_offset",{segment_id:item.id,condition,payload:{automatic:false}});enter("rating")}}>Продолжить {canClose?<ArrowRight size={20}/>:null}</button></div></Frame>;
  if(stage==="rating") return <Frame eyebrow="Оценка подсказки"><div className="rating-content"><h2>Насколько полезной была подсказка?</h2><Scale value={rating} onChange={async n=>{setRating(n);await save("hint_rating",item.id,{value:n,timeout:false,condition,practice});emit(40,"hint_rating",{segment_id:item.id,condition,payload:{value:n}});emit(41,"hint_rating_offset",{segment_id:item.id,condition});enter("recovery")}} left="Совсем не полезна" right="Очень полезна"/></div></Frame>;
  if(stage==="recovery") return <Frame eyebrow="Короткая пауза"><div className="fixation">+</div></Frame>;
  const keys=optionOrder||Object.keys(item.options);
  return <Frame eyebrow={practice?"Тренировочное задание":"Выберите ответ"}><div className="answer-content"><h2>{item.stem}</h2><div className="options">{keys.map((key,index)=><button key={key} className={choice===key?"selected":""} onClick={()=>setChoice(key)}><span>{index+1}</span>{item.options[key]}</button>)}</div><button className="primary" disabled={!choice} onClick={async()=>{await save("segment_answer",item.id,{selected:choice,selected_text:item.options[choice],correct:item.correct,is_correct:choice===item.correct,timeout:false,condition,practice});emit(51,"answer",{segment_id:item.id,condition,payload:{selected:choice,display_position:keys.indexOf(choice)+1}});onDone()}}>Подтвердить <Check size={20}/></button></div></Frame>;
}

function VideoClip({clip,demo,onDone,emit,videoId,index,total}) {
  const [failed,setFailed]=useState(false); const ref=useRef(null);
  useEffect(()=>{if(index===0)emit(20,"video_onset",{payload:{video_id:videoId}});emit(22,"clip_onset",{segment_id:clip.segment_id,payload:{file:clip.file,video_id:videoId}});},[clip.file]);
  const finish=()=>{emit(23,"clip_offset",{segment_id:clip.segment_id,payload:{file:clip.file,video_id:videoId}});onDone();};
  return <Frame eyebrow="Просмотр видео" progress={`Фрагмент ${index+1} из ${total}`}><div className="video-wrap">{!failed?<video ref={ref} src={`/clips/${clip.file}`} autoPlay playsInline controls={false} onEnded={finish} onError={()=>setFailed(true)}/>:<div className="missing"><Play size={42}/><h2>Видеофайл пока не добавлен</h2><p>{clip.file}</p></div>}{demo&&<button className="demo-button" onClick={finish}>Завершить фрагмент в деморежиме <ArrowRight size={18}/></button>}</div></Frame>;
}

function FinalTest({config,session,demo,onDone,emit,save}) {
  const order=session.assignment.final_test_order; const [pos,setPos]=useState(0); const [choice,setChoice]=useState(null); const item=useMemo(()=>config.final_test.find(x=>x.id===order[pos]),[pos]);
  useEffect(()=>{emit(80,"final_item_onset",{segment_id:item.id,payload:{position:pos+1}});setChoice(null)},[pos]);
  useDelay(demo?15000:config.settings.final_test_timeout_ms,async()=>{await save("final_answer",item.id,{selected:null,correct:item.correct,is_correct:false,timeout:true,position:pos+1});emit(82,"final_answer",{segment_id:item.id,payload:{timeout:true}});pos+1<order.length?setPos(pos+1):onDone()},[pos]);
  return <Frame eyebrow="Итоговый тест" progress={`${pos+1} из ${order.length}`}><div className="answer-content"><h2>{item.stem}</h2><div className="options">{session.assignment.option_orders[item.id].map((key,i)=><button key={key} className={choice===key?"selected":""} onClick={()=>setChoice(key)}><span>{i+1}</span>{item.options[key]}</button>)}</div><button className="primary" disabled={!choice} onClick={async()=>{await save("final_answer",item.id,{selected:choice,selected_text:item.options[choice],correct:item.correct,is_correct:choice===item.correct,timeout:false,position:pos+1});emit(82,"final_answer",{segment_id:item.id,payload:{selected:choice}});pos+1<order.length?setPos(pos+1):onDone()}}>Подтвердить <ArrowRight size={20}/></button></div></Frame>;
}

function NASA({config,session,onDone,save,emit}) {
  const [block,setBlock]=useState(0),[itemPos,setItemPos]=useState(0),[value,setValue]=useState(null); const condition=session.assignment.nasa_order[block], item=config.nasa[itemPos];
  return <Frame eyebrow="Оценка нагрузки" progress={`Блок ${block+1} из 3`}><div className="nasa"><h2>{item.title}</h2><p>{item.text}</p><div className="nasa-grid">{Array.from({length:21},(_,i)=>i).map(n=><button className={value===n?"selected":""} key={n} onClick={()=>setValue(n)}>{n}</button>)}</div><div className="scale-labels"><span>{item.left}</span><span>{item.right}</span></div><button className="primary" disabled={value===null} onClick={async()=>{await save("nasa",`${condition}_${item.id}`,{condition,item_id:item.id,value,reverse_key:!!item.reverse_key});emit(90,"nasa_answer",{condition,payload:{item_id:item.id,value}});setValue(null);if(itemPos+1<config.nasa.length)setItemPos(itemPos+1);else if(block+1<3){setBlock(block+1);setItemPos(0)}else onDone()}}>Продолжить <ArrowRight size={20}/></button></div></Frame>;
}

export default function Experiment({config,initialSession,demo,onFinish}) {
  const [session,setSession]=useState(initialSession); const state=session.state||{}; const phase=state.phase||"practice"; const [trial,setTrial]=useState(null); const [value,setValue]=useState(null);
  const subject=session.subject_id; const persist=async next=>{await api.state(subject,next);const s={...session,state:next};setSession(s);};
  const emit=(code,name,details={})=>api.event(subject,code,name,details).catch(()=>{}); const save=(type,key,payload)=>api.record(subject,type,key,payload);
  useEffect(()=>{if(!state.session_started){emit(10,"session_start");persist({...state,session_started:true})}},[]);

  if(phase==="practice") { const pos=state.step||0; return <HintTrial key={`practice-${pos}`} item={PRACTICE[pos]} condition={["AI","EXPERT"][pos]} settings={config.settings} demo={demo} practice emit={emit} save={save} onDone={()=>pos+1<PRACTICE.length?persist({...state,step:pos+1}):persist({screen:"experiment",phase:"calibration"})}/>; }
  if(phase==="calibration") return <Frame eyebrow="Подготовка оборудования"><div className="operator"><h2>Калибровка айтрекера</h2><p>Исследователь запускает калибровку и проверяет качество сигнала. После успешной проверки передайте управление участнику.</p><button className="primary" onClick={()=>{emit(11,"calibration_start");emit(12,"calibration_end");persist({screen:"experiment",phase:"video",videoPos:0,clipPos:0,trialStage:"clip"})}}>Калибровка завершена <Check size={20}/></button></div></Frame>;
  if(phase==="drift") return <Frame eyebrow="Проверка оборудования"><div className="operator"><h2>Проверка положения взгляда</h2><p>Исследователь выполняет drift check перед следующим видео.</p><button className="primary" onClick={()=>{emit(13,"drift_check");persist({...state,phase:"video",clipPos:0,trialStage:"clip"})}}>Проверка завершена <ArrowRight size={20}/></button></div></Frame>;
  if(phase==="video") {
    const videoId=session.assignment.video_order[state.videoPos], video=config.videos.find(v=>v.id===videoId), clip=video.clips[state.clipPos], seg=clip?.segment_id?config.segments.find(s=>s.id===clip.segment_id):null;
    const completeClip=()=>{ if(seg) persist({...state,trialStage:"fixation"}); else finishVideo(); };
    const finishVideo=()=>{emit(21,"video_offset",{payload:{video_id:videoId}});persist({...state,phase:"learnability"});};
    const nextClip=()=>{const next=state.clipPos+1;if(next<video.clips.length)persist({...state,clipPos:next,trialStage:"clip"});else finishVideo();};
    if(state.trialStage==="fixation") return <Fixation ms={demo?700:config.settings.fixation_ms} onDone={()=>{emit(31,"fixation_offset",{segment_id:seg.id});persist({...state,trialStage:"trial"})}}/>;
    if(state.trialStage==="trial") return <HintTrial key={seg.id} item={seg} condition={session.assignment.segment_conditions[seg.id]} optionOrder={session.assignment.option_orders[seg.id]} settings={config.settings} demo={demo} emit={emit} save={save} onDone={nextClip}/>;
    return <VideoClip key={clip.file} clip={clip} demo={demo} videoId={videoId} index={state.clipPos} total={video.clips.length} emit={emit} onDone={completeClip}/>;
  }
  if(phase==="learnability") return <Frame eyebrow="Оценка видео"><div className="rating-content"><h2>Насколько легко было следить за изложением материала?</h2><Scale value={value} onChange={setValue} left="Очень трудно" right="Очень легко"/><button className="primary" disabled={!value} onClick={async()=>{const p=state.videoPos;await save("video_rating",session.assignment.video_order[p],{value});emit(70,"video_rating",{payload:{value,video_id:session.assignment.video_order[p]}});setValue(null);p+1<3?persist({screen:"experiment",phase:"drift",videoPos:p+1}):persist({screen:"experiment",phase:"final_intro"})}}>Продолжить <ArrowRight size={20}/></button></div></Frame>;
  if(phase==="final_intro") return <Frame eyebrow="Заключительная часть"><div className="operator"><h2>Итоговый тест</h2><p>Далее появятся 27 вопросов по содержанию трех видео. На каждый вопрос отводится до 60 секунд. Вернуться к предыдущему вопросу нельзя.</p><button className="primary" onClick={()=>persist({screen:"experiment",phase:"final"})}>Начать тест <ArrowRight size={20}/></button></div></Frame>;
  if(phase==="final") return <FinalTest config={config} session={session} demo={demo} emit={emit} save={save} onDone={()=>persist({screen:"experiment",phase:"nasa"})}/>;
  if(phase==="nasa") return <NASA config={config} session={session} emit={emit} save={save} onDone={()=>persist({screen:"experiment",phase:"manipulation",manipulationPos:0})}/>;
  if(phase==="manipulation") { const questions=[{key:"ai",text:"Насколько вероятно, что подсказки с пометкой «ИИ-помощник» были подготовлены искусственным интеллектом?"},{key:"expert",text:"Насколько вероятно, что подсказки с пометкой «Эксперт» были подготовлены человеком?"}];const p=state.manipulationPos||0,q=questions[p];return <Frame eyebrow="Завершающие вопросы" progress={`${p+1} из 2`}><div className="rating-content"><h2>{q.text}</h2><Scale value={value} onChange={setValue} left="Совсем не вероятно" right="Очень вероятно"/><button className="primary" disabled={!value} onClick={async()=>{await save("manipulation",q.key,{value});emit(95,"manipulation_answer",{payload:{key:q.key,value}});setValue(null);p===0?persist({...state,manipulationPos:1}):persist({screen:"experiment",phase:"debrief"})}}>Продолжить <ArrowRight size={20}/></button></div></Frame>; }
  if(phase==="debrief") return <Frame eyebrow="Информация об исследовании"><div className="operator"><h2>Спасибо</h2><p>В исследовании сравнивались три типа заранее подготовленных подсказок. Их обозначения использовались как часть экспериментальной процедуры и не обязательно отражали реальный источник текста.</p><button className="primary" onClick={async()=>{emit(99,"session_end");await api.complete(subject);const next={...session,status:"completed",state:{screen:"completed"}};await api.state(subject,next.state);onFinish(next)}}>Завершить <Check size={20}/></button></div></Frame>;
  return <Frame><button onClick={()=>persist({screen:"experiment",phase:"practice",step:0})}><RotateCcw/> Начать заново</button></Frame>;
}
