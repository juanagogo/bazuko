// IDM, bend caps and MOBIL safety adapted from Slop New York 1b54e165/js/traffic.js (MIT).
export const CAR_DRIVER=Object.freeze({a:2,b:3,T:1.2,s0:2,aLat:3.5});
export const BUS_DRIVER=Object.freeze({a:1.1,b:2.5,T:1.5,s0:2.5,aLat:2});
export const LOOKAHEAD=70;
export function freeAcc(v){return v.driver.a*(1-(v.speed/v.v0)**4);}
export function brake(v,gap,speed,s0=v.driver.s0,T=v.driver.T){
 const {a,b}=v.driver,desired=s0+Math.max(0,v.speed*T+v.speed*(v.speed-speed)/(2*Math.sqrt(a*b)));
 return -a*(desired/Math.max(gap,.1))**2;
}
export function stopAt(v,d,s0=1){return brake(v,d,0,s0,0);}
export function canStopBefore(v,d,phase='green'){return freeAcc(v)+stopAt(v,d)>-v.driver.b||(phase!=='green'&&v.speed*v.speed<2*v.driver.b*d);}
export function acceleration(v,{gap=Infinity,leaderSpeed=0,stopDistance=Infinity,cap=Infinity,playerGap=Infinity,playerSpeed=0}={}){
 let worst=gap<LOOKAHEAD?brake(v,gap,leaderSpeed):0;
 if(stopDistance<LOOKAHEAD)worst=Math.min(worst,stopAt(v,stopDistance));
 if(playerGap<LOOKAHEAD)worst=Math.min(worst,brake(v,playerGap,playerSpeed));
 const acc=Math.min(freeAcc(v)+worst,(cap-v.speed)*2);
 return Math.max(-9,Math.min(v.driver.a,acc));
}
export function laneAcceleration(v,lead,gap){return freeAcc(v)+(lead?brake(v,gap,lead.speed):0);}
export function laneSafe(v,lead,leadGap,follower,followerGap,bSafe=-3){
 if(lead&&(leadGap<1.5||freeAcc(v)+brake(v,leadGap,lead.speed)<bSafe))return false;
 if(follower&&(followerGap<1.5||freeAcc(follower)+brake(follower,followerGap,v.speed)<bSafe))return false;
 return true;
}
