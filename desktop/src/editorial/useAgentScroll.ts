import {useCallback,useLayoutEffect,useRef,useState} from 'react';

// Follow is reading intent, not distance to the bottom after a streamed layout.
// Only actual upward scrolling pauses it; resizing/receiving text must not do so.
export function useAgentScroll(active:boolean,sessionId:string|undefined,revision:unknown){
 const scroll=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const following=useRef(true),lastTop=useRef(0),[follow,setFollow]=useState(true);
 const setFollowing=useCallback((value:boolean)=>{following.current=value;setFollow(value);},[]);
 const pin=useCallback(()=>{const el=scroll.current;if(active&&el?.clientHeight&&following.current){el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop;}},[active]);
 const pause=useCallback(()=>setFollowing(false),[setFollowing]);
 const jump=useCallback(()=>{setFollowing(true);pin();},[pin,setFollowing]);
 const onScroll=useCallback(()=>{const el=scroll.current;if(!el)return;const bottom=el.scrollHeight-el.scrollTop-el.clientHeight<=2;
  if(bottom)setFollowing(true);
  else if(el.scrollTop<lastTop.current-.5)setFollowing(false);
  lastTop.current=el.scrollTop;
 },[setFollowing]);
 useLayoutEffect(()=>{setFollowing(true);},[sessionId,setFollowing]);
 useLayoutEffect(pin,[pin,revision,sessionId]);
 useLayoutEffect(()=>{
  if(!active||typeof ResizeObserver==='undefined')return;
  let frame=0;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(pin);});
  if(scroll.current)observer.observe(scroll.current);if(content.current)observer.observe(content.current);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[active,pin]);
 return {scroll,content,follow,jump,onScroll,pause};
}
