import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, Check, Lightbulb, Play, UserRound } from "lucide-react";
import { api } from "./api";

const LABELS = {AI: "Ответ ИИ-помощника", EXPERT: "Ответ эксперта", CONTROL: "Подсказка"};
const NASA_INSTRUCTIONS = {
  AI: "Вспомните те моменты просмотра, когда подсказку Вам давал ИИ-помощник. Оцените свои ощущения именно в эти моменты.",
  EXPERT: "Вспомните те моменты просмотра, когда подсказку Вам давал эксперт. Оцените свои ощущения именно в эти моменты.",
  CONTROL: "Вспомните те задания, где подсказка предлагала подумать над ответом самостоятельно. Оцените свои ощущения именно в эти моменты.",
};
const PRACTICE = [
  {id:"P1", clip_file:"practice_1.mp4", duration_sec:8, stem:"Какая фигура появилась в начале фрагмента?", options:{A:"Круг",B:"Квадрат",C:"Треугольник",D:"Линия"}, correct:"B", hints:{ai:"Вспомните первые секунды: в центре была фигура с четырьмя равными сторонами.",expert:"Мысленно вернитесь к началу: первой была фигура с четырьмя равными сторонами.",control:"Вспомните начало фрагмента и выберите вариант, который считаете верным."}},
  {id:"P2", clip_file:"practice_2.mp4", duration_sec:8, stem:"Какого цвета была фигура во втором фрагменте?", options:{A:"Красного",B:"Синего",C:"Зелёного",D:"Жёлтого"}, correct:"C", hints:{ai:"Обратите внимание на цвет второй фигуры: это цвет листвы и травы.",expert:"Вспомните вторую фигуру: её цвет обычно связывают с листвой и травой.",control:"Вспомните цвет фигуры и выберите вариант, который считаете верным."}},
];

function useDelay(ms, callback, dependencies = []) {
  const current = useRef(callback);
  current.current = callback;
  useEffect(() => {
    if (ms == null) return undefined;
    const timer = setTimeout(() => current.current(), ms);
    return () => clearTimeout(timer);
  }, [ms, ...dependencies]);
}

function Scale({value, onChange, left, right}) {
  return <div className="scale" data-aoi="rating_scale"><div className="scale-buttons">{[1,2,3,4,5,6,7].map(number=><button key={number} className={value===number?"selected":""} onClick={()=>onChange(number)}>{number}</button>)}</div><div className="scale-labels"><span>{left}</span><span>{right}</span></div></div>;
}

function NasaScale({left,right,onCommit}) {
  const [value,setValue]=useState(null);
  return <div className="nasa-scale" data-aoi="nasa_scale">
    <input aria-label="Оценка от 0 до 100" className={value===null?"empty":""} type="range" min="0" max="100" step="5" value={value??50} onChange={event=>setValue(Number(event.target.value))} onPointerUp={event=>onCommit(Number(event.currentTarget.value))} onKeyUp={event=>{if(["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(event.key))onCommit(Number(event.currentTarget.value));}}/>
    <div className="nasa-ticks" aria-hidden="true">{Array.from({length:21},(_,index)=><i key={index}/>)}</div>
    <div className="scale-labels"><span>{left}</span><span>{right}</span></div>
  </div>;
}

function Frame({children, eyebrow, progress, screen="service"}) {
  return <div className={`study-screen screen-${screen}`} data-screen={screen}><div className="study-top"><span>{eyebrow}</span>{progress&&<span>{progress}</span>}</div><section className="study-card">{children}</section></div>;
}

function Fixation({ms, segmentId, condition, emit, onDone}) {
  const started = useRef(Date.now());
  useEffect(()=>{started.current=Date.now();emit(31,"fixation_onset",{segment_id:segmentId,condition});},[segmentId]);
  useDelay(ms,()=>onDone(started.current),[segmentId]);
  return <Frame eyebrow="" screen="fixation"><div className="fixation" data-aoi="fixation_cross">+</div></Frame>;
}

function conditionIcon(condition) {
  if (condition === "AI") return <Bot size={48} strokeWidth={1.7}/>;
  if (condition === "EXPERT") return <UserRound size={48} strokeWidth={1.7}/>;
  return <Lightbulb size={48} strokeWidth={1.7}/>;
}

function HintTrial({item, condition, settings, demo, practice=false, optionOrder, clipTiming={}, fixationAt, onDone, emit, save}) {
  const [stage,setStage]=useState("question");
  const [canClose,setCanClose]=useState(false);
  const closed=useRef(false);
  const ratingDone=useRef(false);
  const answerDone=useRef(false);
  const times=useRef({...clipTiming});
  const keys=optionOrder||Object.keys(item.options);
  const duration=(name,value)=>demo?({hintMin:1200,hintMax:8000,rating:10000,recovery:1200,answer:30000}[name]):value;

  useEffect(()=>{
    const timestamp=Date.now();
    if(stage==="question") {times.current.T_fixation_ms=fixationAt||"";times.current.T_question_ms=timestamp;emit(32,"question_onset",{segment_id:item.id,condition});}
    if(stage==="hint") {times.current.T_hintShown_ms=timestamp;emit(34,"hint_onset",{segment_id:item.id,condition});}
    if(stage==="rating") {times.current.T_satisfaction_ms=timestamp;emit(40,"satisfaction_onset",{segment_id:item.id,condition});}
    if(stage==="recovery") {times.current.T_recoveryStart_ms=timestamp;emit(36,"recovery_onset",{segment_id:item.id,condition});}
    if(stage==="answer") {times.current.T_recoveryEnd_ms=timestamp;times.current.T_answerOptions_ms=timestamp;emit(37,"recovery_offset",{segment_id:item.id,condition});emit(50,"answer_options_onset",{segment_id:item.id,condition});}
  },[stage,item.id]);

  const closeHint=(automatic=false)=>{
    if(closed.current)return;
    closed.current=true;
    const timestamp=Date.now();
    times.current.T_hintClosed_ms=timestamp;
    times.current.HintReadTime_ms=timestamp-times.current.T_hintShown_ms;
    emit(35,"hint_offset",{segment_id:item.id,condition,payload:{automatic,read_time_ms:times.current.HintReadTime_ms}});
    setStage("rating");
  };
  const beginHint=()=>{
    const timestamp=Date.now();
    times.current.T_hintRequest_ms=timestamp;
    times.current.LatencyToHint_ms=timestamp-times.current.T_question_ms;
    emit(33,"hint_request",{segment_id:item.id,condition,payload:{latency_ms:times.current.LatencyToHint_ms}});
    setStage("hint");
  };
  const finishRating=async(value,timeout=false)=>{
    if(ratingDone.current)return;
    ratingDone.current=true;
    const timestamp=Date.now();
    times.current.Satisfaction=value;
    times.current.SatisfactionRT_ms=timestamp-times.current.T_satisfaction_ms;
    await save("hint_rating",item.id,{value,timeout,condition,practice,rt_ms:times.current.SatisfactionRT_ms});
    emit(41,"satisfaction_answer",{segment_id:item.id,condition,payload:{value,timeout,rt_ms:times.current.SatisfactionRT_ms}});
    setStage("recovery");
  };
  const finishAnswer=async(selected,timeout=false)=>{
    if(answerDone.current)return;
    answerDone.current=true;
    const timestamp=Date.now();
    const payload={...times.current,ProbeAnswerKey:selected||"",ProbeAnswerPosition:selected?keys.indexOf(selected)+1:"",ProbeCorrect:selected===item.correct,ProbeRT_ms:timestamp-times.current.T_answerOptions_ms,T_answer_ms:timestamp,IsPractice:practice};
    await save("trial",item.id,payload);
    await save("segment_answer",item.id,{selected:selected||null,selected_text:selected?item.options[selected]:null,correct:item.correct,is_correct:selected===item.correct,timeout,condition,practice,rt_ms:payload.ProbeRT_ms});
    emit(51,"answer",{segment_id:item.id,condition,payload:{selected:selected||null,display_position:payload.ProbeAnswerPosition,is_correct:payload.ProbeCorrect,timeout,rt_ms:payload.ProbeRT_ms}});
    onDone();
  };

  useDelay(stage==="hint"?duration("hintMin",settings.hint_min_ms):null,()=>setCanClose(true),[stage]);
  useDelay(stage==="hint"?duration("hintMax",settings.hint_max_ms):null,()=>closeHint(true),[stage]);
  useDelay(stage==="rating"?duration("rating",settings.satisfaction_timeout_ms):null,()=>finishRating(null,true),[stage]);
  useDelay(stage==="recovery"?duration("recovery",settings.recovery_ms):null,()=>setStage("answer"),[stage]);
  useDelay(stage==="answer"?duration("answer",settings.probe_timeout_ms):null,()=>finishAnswer(null,true),[stage]);

  if(stage==="question")return <Frame eyebrow={practice?"Тренировочное задание":"Вопрос по фрагменту"} screen="question"><div className="question-only"><h2 data-aoi="question_text">{item.stem}</h2><button data-aoi="hint_request_button" className="primary" onClick={beginHint}><Lightbulb size={20}/>Нужна подсказка</button></div></Frame>;
  if(stage==="hint")return <Frame eyebrow={LABELS[condition]} screen="hint"><div className="hint-content"><div className="source-icon" data-aoi="source_icon">{conditionIcon(condition)}</div><h2 data-aoi="source_label">{LABELS[condition]}</h2><p data-aoi="hint_text">{item.hints[condition.toLowerCase()]}</p><button data-aoi="hint_continue_button" className="primary" disabled={!canClose} onClick={()=>closeHint(false)}>Продолжить <ArrowRight size={20}/></button></div></Frame>;
  if(stage==="rating")return <Frame eyebrow="Оценка ответа" screen="satisfaction"><div className="rating-content"><h2 data-aoi="rating_question">Насколько полезным и удовлетворительным был для Вас этот ответ?</h2><Scale value={null} onChange={value=>finishRating(value,false)} left="Совсем не полезен" right="Максимально полезен"/></div></Frame>;
  if(stage==="recovery")return <Frame eyebrow="" screen="recovery"><div className="fixation" data-aoi="fixation_cross">+</div></Frame>;
  return <Frame eyebrow={practice?"Тренировочное задание":"Выберите ответ"} screen="answer"><div className="answer-content"><h2 data-aoi="question_text">{item.stem}</h2><div className="options">{keys.map((key,index)=><button data-aoi={`answer_option_${index+1}`} key={key} onClick={()=>finishAnswer(key,false)}><span>{index+1}</span>{item.options[key]}</button>)}</div></div></Frame>;
}

function VideoClip({clip,demo,onDone,emit,videoId,videoPosition,index,total,nextFile,practice=false}) {
  const [failed,setFailed]=useState(false);
  const started=useRef(null);
  const emitted=useRef(false);
  const finish=()=>{
    const ended=Date.now();
    const timing={T_clipStart_ms:started.current||ended,T_clipEnd_ms:ended};
    emit(23,"clip_offset",{segment_id:clip.segment_id,payload:{file:clip.file,video_id:videoId,actual_duration_ms:ended-(started.current||ended),practice}});
    onDone(timing);
  };
  const playing=()=>{
    if(emitted.current)return;
    emitted.current=true;
    started.current=Date.now();
    if(index===0)emit(20,"video_onset",{payload:{video_id:videoId,order_position:videoPosition,practice}});
    emit(22,"clip_onset",{segment_id:clip.segment_id,payload:{file:clip.file,video_id:videoId,duration_ms:Math.round(clip.duration_sec*1000),practice}});
  };
  return <Frame eyebrow={practice?"Тренировочный фрагмент":"Просмотр видео"} progress={practice?null:`Фрагмент ${index+1} из ${total}`} screen="video"><div className="video-wrap" data-aoi="video">{!failed?<video src={`/clips/${clip.file}`} autoPlay playsInline controls={false} onPlaying={playing} onEnded={finish} onError={()=>setFailed(true)}/>:<div className="missing"><Play size={42}/><h2>Видеофайл не найден</h2><p>{clip.file}</p></div>}{nextFile&&<video className="video-preload" src={`/clips/${nextFile}`} preload="auto" muted playsInline/>}{demo&&<button className="demo-button" onClick={()=>{playing();finish();}}>Завершить фрагмент в деморежиме <ArrowRight size={18}/></button>}</div></Frame>;
}

function Calibration({emit,onDone}) {
  useEffect(()=>{emit(11,"calibration_start");},[]);
  return <Frame eyebrow="Подготовка оборудования" screen="operator"><div className="operator"><h2>Калибровка айтрекера</h2><p>Выполните калибровку на оборудовании перед продолжением исследования.</p><button className="primary" onClick={()=>{emit(12,"calibration_end",{payload:{accuracy_recorded:false}});onDone({accuracy_recorded:false});}}>Далее <ArrowRight size={20}/></button></div></Frame>;
}

function DriftCheck({emit,onDone}) {
  const [values,setValues]=useState({error_x:"",error_y:""});
  return <Frame eyebrow="Проверка оборудования" screen="operator"><div className="operator"><h2>Проверка положения взгляда</h2><p>Выполните drift-check и внесите значения с оборудования.</p><div className="calibration-fields"><label>Смещение по X, °<input type="number" step="0.01" value={values.error_x} onChange={event=>setValues({...values,error_x:event.target.value})}/></label><label>Смещение по Y, °<input type="number" step="0.01" value={values.error_y} onChange={event=>setValues({...values,error_y:event.target.value})}/></label></div><button className="primary" disabled={values.error_x===""||values.error_y===""} onClick={()=>{emit(13,"drift_check",{payload:values});onDone(values);}}>Проверка завершена <ArrowRight size={20}/></button></div></Frame>;
}

function FinalTest({config,session,demo,onDone,emit,save}) {
  const order=session.assignment.final_test_order;
  const [position,setPosition]=useState(0);
  const item=useMemo(()=>config.final_test.find(candidate=>candidate.id===order[position]),[position]);
  const started=useRef(Date.now());
  const answered=useRef(false);
  useEffect(()=>{emit(80,"final_test_start",{payload:{total:order.length}});},[]);
  useEffect(()=>{answered.current=false;started.current=Date.now();emit(81,"final_item_onset",{segment_id:item.segment_id,condition:session.assignment.segment_conditions[item.segment_id],payload:{item_id:item.id,position:position+1}});},[position]);
  const answer=async(selected,timeout=false)=>{
    if(answered.current)return;
    answered.current=true;
    const condition=session.assignment.segment_conditions[item.segment_id];
    const optionOrder=session.assignment.option_orders[item.id];
    const payload={item_id:item.id,segment_id:item.segment_id,condition,selected:selected||null,selected_text:selected?item.options[selected]:null,selected_position:selected?optionOrder.indexOf(selected)+1:null,correct:item.correct,is_correct:selected===item.correct,timeout,rt_ms:Date.now()-started.current,position:position+1};
    await save("final_answer",item.id,payload);
    emit(82,"final_answer",{segment_id:item.segment_id,condition,payload});
    position+1<order.length?setPosition(position+1):onDone();
  };
  useDelay(demo?15000:config.settings.final_test_timeout_ms,()=>answer(null,true),[position]);
  return <Frame eyebrow="Итоговый тест" progress={`${position+1} из ${order.length}`} screen="final-test"><div className="answer-content"><h2 data-aoi="question_text">{item.stem}</h2><div className="options">{session.assignment.option_orders[item.id].map((key,index)=><button data-aoi={`answer_option_${index+1}`} key={key} onClick={()=>answer(key,false)}><span>{index+1}</span>{item.options[key]}</button>)}</div></div></Frame>;
}

function NASA({config,session,onDone,save,emit}) {
  const [block,setBlock]=useState(0);
  const [itemPosition,setItemPosition]=useState(0);
  const condition=session.assignment.nasa_order[block];
  const item=config.nasa[itemPosition];
  const answering=useRef(false);
  useEffect(()=>{emit(90,"nasa_block",{condition,payload:{action:"start",block_position:block+1}});},[block]);
  useEffect(()=>{answering.current=false;},[block,itemPosition]);
  const answer=async value=>{
    if(answering.current)return;
    answering.current=true;
    await save("nasa",`${condition}_${item.id}`,{condition,item_id:item.id,value,reverse_key:!!item.reverse_key});
    emit(90,"nasa_block",{condition,payload:{action:"answer",item_id:item.id,value}});
    if(itemPosition+1<config.nasa.length)setItemPosition(itemPosition+1);
    else if(block+1<3){setBlock(block+1);setItemPosition(0);}
    else onDone();
  };
  return <Frame eyebrow="Оценка нагрузки" progress={`Блок ${block+1} из 3`} screen="nasa"><div className="nasa"><p className="nasa-instruction">{NASA_INSTRUCTIONS[condition]}</p><h2>{item.title}</h2><p>{item.text}</p><NasaScale key={`${condition}-${item.id}`} left={item.left} right={item.right} onCommit={answer}/></div></Frame>;
}

export default function Experiment({config,initialSession,demo,onFinish}) {
  const [session,setSession]=useState(initialSession);
  const [scaleValue,setScaleValue]=useState(null);
  const state=session.state||{};
  const phase=state.phase||"practice";
  const subject=session.subject_id;
  const persist=async next=>{await api.state(subject,next);setSession({...session,state:next});};
  const emit=(code,name,details={})=>api.event(subject,code,name,details).catch(()=>{});
  const save=(type,key,payload)=>api.record(subject,type,key,payload);
  useEffect(()=>{if(!state.session_started){emit(10,"session_start",{payload:{config_version:config.config_version}});persist({...state,session_started:true});}},[]);

  if(phase==="practice"){
    const position=state.step||0;
    const item=PRACTICE[position];
    const clip={file:item.clip_file,duration_sec:item.duration_sec,segment_id:item.id};
    if((state.trialStage||"clip")==="clip")return <VideoClip key={clip.file} clip={clip} demo={demo} practice videoId="practice" videoPosition={0} index={position} total={2} nextFile={position===0?PRACTICE[1].clip_file:null} emit={emit} onDone={clipTiming=>persist({...state,trialStage:"fixation",clipTiming})}/>;
    if(state.trialStage==="fixation")return <Fixation ms={demo?700:config.settings.fixation_ms} segmentId={item.id} condition={position===0?"AI":"EXPERT"} emit={emit} onDone={fixationAt=>persist({...state,trialStage:"trial",fixationAt})}/>;
    return <HintTrial key={item.id} item={item} condition={position===0?"AI":"EXPERT"} settings={config.settings} demo={demo} practice clipTiming={state.clipTiming} fixationAt={state.fixationAt} emit={emit} save={save} onDone={()=>position+1<PRACTICE.length?persist({...state,step:position+1,trialStage:"clip",clipTiming:null,fixationAt:null}):persist({screen:"experiment",phase:"calibration",videoPos:0})}/>;
  }
  if(phase==="calibration")return <Calibration emit={emit} onDone={values=>persist({screen:"experiment",phase:"video",videoPos:state.videoPos||0,clipPos:0,trialStage:"clip",calibration:values})}/>;
  if(phase==="drift")return <DriftCheck emit={emit} onDone={values=>persist({...state,phase:"video",clipPos:0,trialStage:"clip",drift:values})}/>;
  if(phase==="video"){
    const videoId=session.assignment.video_order[state.videoPos];
    const video=config.videos.find(candidate=>candidate.id===videoId);
    const clip=video.clips[state.clipPos];
    const segment=clip.segment_id?config.segments.find(candidate=>candidate.id===clip.segment_id):null;
    const nextFile=video.clips[state.clipPos+1]?.file;
    const finishVideo=()=>{emit(21,"video_offset",{payload:{video_id:videoId,order_position:state.videoPos+1}});persist({...state,phase:"learnability"});};
    const nextClip=()=>{const next=state.clipPos+1;next<video.clips.length?persist({...state,clipPos:next,trialStage:"clip",clipTiming:null,fixationAt:null}):finishVideo();};
    if((state.trialStage||"clip")==="clip")return <VideoClip key={clip.file} clip={clip} demo={demo} videoId={videoId} videoPosition={state.videoPos+1} index={state.clipPos} total={video.clips.length} nextFile={nextFile} emit={emit} onDone={clipTiming=>segment?persist({...state,trialStage:"fixation",clipTiming}):finishVideo()}/>;
    const condition=session.assignment.segment_conditions[segment.id];
    if(state.trialStage==="fixation")return <Fixation ms={demo?700:config.settings.fixation_ms} segmentId={segment.id} condition={condition} emit={emit} onDone={fixationAt=>persist({...state,trialStage:"trial",fixationAt})}/>;
    return <HintTrial key={segment.id} item={segment} condition={condition} optionOrder={session.assignment.option_orders[segment.id]} settings={config.settings} demo={demo} clipTiming={state.clipTiming} fixationAt={state.fixationAt} emit={emit} save={save} onDone={nextClip}/>;
  }
  if(phase==="learnability")return <Frame eyebrow="Оценка видео" screen="learnability"><div className="rating-content"><h2>Насколько легко Вам было усвоить материал этого видео?</h2><Scale value={scaleValue} onChange={setScaleValue} left="Очень тяжело" right="Очень легко"/><button className="primary" disabled={!scaleValue} onClick={async()=>{const videoId=session.assignment.video_order[state.videoPos];await save("video_rating",videoId,{value:scaleValue});emit(70,"video_rating",{payload:{value:scaleValue,video_id:videoId}});setScaleValue(null);state.videoPos+1<3?persist({screen:"experiment",phase:"drift",videoPos:state.videoPos+1}):persist({screen:"experiment",phase:"final_intro"});}}>Продолжить <ArrowRight size={20}/></button></div></Frame>;
  if(phase==="final_intro")return <Frame eyebrow="Заключительная часть" screen="service"><div className="operator"><h2>Итоговый тест</h2><p>Далее появятся 27 вопросов по содержанию трёх видео. На каждый вопрос отводится до 60 секунд. Ответ фиксируется одним нажатием. Вернуться к предыдущему вопросу нельзя.</p><button className="primary" onClick={()=>persist({screen:"experiment",phase:"final"})}>Начать тест <ArrowRight size={20}/></button></div></Frame>;
  if(phase==="final")return <FinalTest config={config} session={session} demo={demo} emit={emit} save={save} onDone={()=>persist({screen:"experiment",phase:"nasa"})}/>;
  if(phase==="nasa")return <NASA config={config} session={session} emit={emit} save={save} onDone={()=>persist({screen:"experiment",phase:"manipulation",manipulationPos:0})}/>;
  if(phase==="manipulation"){
    const questions=[{key:"ai",text:"Насколько вероятно, что подсказки с пометкой «ИИ-помощник» были подготовлены искусственным интеллектом?"},{key:"expert",text:"Насколько вероятно, что подсказки с пометкой «Эксперт» были подготовлены человеком?"}];
    const position=state.manipulationPos||0;
    const question=questions[position];
    return <Frame eyebrow="Завершающие вопросы" progress={`${position+1} из 2`} screen="manipulation"><div className="rating-content"><h2>{question.text}</h2><Scale value={scaleValue} onChange={setScaleValue} left="Совсем не вероятно" right="Очень вероятно"/><button className="primary" disabled={!scaleValue} onClick={async()=>{await save("manipulation",question.key,{value:scaleValue});emit(95,"manipulation_answer",{payload:{key:question.key,value:scaleValue}});setScaleValue(null);position===0?persist({...state,manipulationPos:1}):persist({screen:"experiment",phase:"debrief"});}}>Продолжить <ArrowRight size={20}/></button></div></Frame>;
  }
  return <Frame eyebrow="Информация об исследовании" screen="debrief"><div className="operator"><h2>Спасибо за участие</h2><p>В исследовании сравнивались три типа заранее подготовленных подсказок. Их обозначения использовались как часть экспериментальной процедуры и не обязательно отражали реальный источник текста.</p><button className="primary" onClick={async()=>{emit(99,"session_end",{payload:{config_version:config.config_version}});await api.complete(subject);const next={...session,status:"completed",state:{screen:"completed"}};await api.state(subject,next.state);if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});onFinish(next);}}>Завершить <Check size={20}/></button></div></Frame>;
}
