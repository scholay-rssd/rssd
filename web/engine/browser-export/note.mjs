// Arrows, dots and counter for the gallery on note and card pages. Without this script the gallery still
// scrolls and snaps by touch, trackpad or keyboard.
for(const media of document.querySelectorAll('.rssd-note-media')){
 const track=media.querySelector('.rssd-note-track'),slides=track?[...track.children]:[];
 const prev=media.querySelector('.rssd-note-prev'),next=media.querySelector('.rssd-note-next');
 if(slides.length<2||!prev||!next)continue;
 const count=media.querySelector('.rssd-note-count b'),dots=[...media.querySelectorAll('.rssd-note-dots i')];
 const still=matchMedia('(prefers-reduced-motion: reduce)');
 const current=()=>Math.max(0,Math.min(slides.length-1,Math.round(track.scrollLeft/Math.max(1,track.clientWidth))));
 const go=index=>track.scrollTo({left:Math.max(0,Math.min(slides.length-1,index))*track.clientWidth,behavior:still.matches?'auto':'smooth'});
 let frame=0;
 const update=()=>{frame=0;const index=current();if(count)count.textContent=String(index+1);dots.forEach((dot,i)=>dot.classList.toggle('on',i===index));prev.disabled=index===0;next.disabled=index===slides.length-1;};
 prev.hidden=next.hidden=false;
 prev.addEventListener('click',()=>go(current()-1));
 next.addEventListener('click',()=>go(current()+1));
 track.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(update);},{passive:true});
 track.addEventListener('keydown',event=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  event.preventDefault();go(current()+(event.key==='ArrowRight'?1:-1));
 });
 update();
}
