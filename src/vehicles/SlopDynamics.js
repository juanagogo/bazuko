// Adapted from Slop New York 09361be1 controllers.js; traffic helpers retain 1b54e165 (MIT).
export const CAR_DRIVE=Object.freeze({speed:11.75,boostSpeed:18,reverseSpeed:5.25,acceleration:4.5,boostAcceleration:5.25,powerSpeed:6.25,rolling:.18,drag:.0012,coast:.6,brake:9});
export function driveSpeed(speed,throttle,boost,dt,drive=CAR_DRIVE){
 const braking=speed*throttle<0,magnitude=Math.abs(speed);
 const deceleration=drive.rolling+(!throttle?drive.coast:braking?Math.abs(throttle)*drive.brake:0);
 const coasting=Math.max(0,magnitude-deceleration*dt)/(1+drive.drag*magnitude*dt);
 if(!throttle||braking)return Math.sign(speed)*coasting;
 const limit=throttle<0?drive.reverseSpeed:boost?drive.boostSpeed:drive.speed;
 let acceleration=boost?drive.boostAcceleration:drive.acceleration;
 if(drive.powerSpeed)acceleration*=drive.powerSpeed/Math.max(drive.powerSpeed,magnitude);
 return Math.sign(throttle)*Math.min(Math.max(limit,coasting),coasting+Math.abs(throttle)*acceleration*dt);
}
export function idmAcceleration(speed,desiredSpeed,gap=Infinity,leaderSpeed=0,{a=1.8,b=2.6,s0=1.8,T=1.1}={}){
 const free=a*(1-(speed/Math.max(.1,desiredSpeed))**4);
 if(!Number.isFinite(gap))return free;
 const desired=s0+Math.max(0,speed*T+speed*(speed-leaderSpeed)/(2*Math.sqrt(a*b)));
 return free-a*(desired/Math.max(gap,.1))**2;
}
export function weightedMove(options,weight,random=Math.random){
 let r=random()*options.reduce((sum,o)=>sum+weight(o),0);
 for(const o of options){r-=weight(o);if(r<=0)return o;}return options.at(-1);
}
