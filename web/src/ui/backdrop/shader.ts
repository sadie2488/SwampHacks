// The Overture background picture, as one full-screen shader (one draw call):
// - the player's own camera picture (mirrored, covering the window), toned by the screen's look
// - a two-ink halftone print on top (the mode's ink pair), its dots grow with the music and the two inks slip apart
//   on the beat and when the section colour changes
// - without a camera: a slow cloud field stands in for the picture, breathing with the song's low bands
// - a ripple that runs through the picture from a chosen record
export const VERT = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`;

export const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uCam;
uniform float uHasCam, uCamAspect, uTime, uLevel, uLow, uHigh, uPulse, uMis, uDot;
uniform float uEffect, uInk, uSat, uTint, uDim, uVignette, uGrain;
uniform vec2 uRes;
uniform vec3 uA, uB, uBg, uClick;

vec2 coverUv(vec2 uv){
  float s=(uRes.x/uRes.y)/uCamAspect;
  if(s>1.) uv.y=(uv.y-.5)/s+.5; else uv.x=(uv.x-.5)*s+.5;
  return vec2(1.-uv.x, uv.y);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y);
}
vec3 cam(vec2 uv){ return texture2D(uCam, coverUv(uv)).rgb; }
// stand-in picture: slow soft clouds, a little brighter with the low bands, a fine shimmer with the high ones
float field(vec2 uv){
  vec2 p=uv*vec2(uRes.x/uRes.y,1.)*2.2;
  float n=noise(p+vec2(uTime*.03,-uTime*.02))*.65+noise(p*2.3-uTime*.05)*(.35+.3*uHigh);
  return smoothstep(.38,.95,n)*(.45+.55*uLow);
}
float lum(vec2 uv){
  if(uHasCam>.5){ vec3 c=cam(uv); return smoothstep(.12,.85,dot(c,vec3(.299,.587,.114))); }
  return field(uv);
}
float ink(vec2 px, float cell, vec2 off, float gain){
  vec2 q=px-off, c=floor(q/cell)*cell+cell*.5;
  float L=lum((c+off)/uRes);
  float r=cell*.55*sqrt(L)*gain;
  return smoothstep(r, r-1.2, length(q-c));
}
void main(){
  vec2 asp=vec2(uRes.x/uRes.y,1.), rd=(vUv-uClick.xy)*asp;
  float age=uTime-uClick.z, ring=length(rd)-age*.9;
  float wave=(age>=0.&&age<3.)?sin(ring*55.)*exp(-ring*ring*30.)*exp(-age*1.4):0.;
  vec2 uv=vUv-normalize(rd+1e-5)/asp*wave*.018;
  vec2 px=uv*uRes;
  float cell=uDot*(1.-.2*uLevel), gain=.9+.6*uLevel+.4*uPulse;
  vec2 mis=vec2(uMis,-uMis)*(1.+uPulse*2.);
  float mA=ink(px,cell,vec2(0.),gain)*uInk, mB=ink(px,cell,mis,gain*.9)*uInk;
  vec3 inkCol=uBg;
  inkCol=1.-(1.-inkCol)*(1.-uB*mB*.75);
  inkCol=1.-(1.-inkCol)*(1.-uA*mA);
  vec3 base=uBg;
  if(uHasCam>.5){
    vec3 c=cam(uv); float Y=dot(c,vec3(.299,.587,.114));
    vec3 clear=mix(vec3(Y),c,uSat);
    clear=mix(clear,clear*mix(uB,uA,smoothstep(.2,.8,Y))*1.5,uTint);
    base=max(uBg, clear*uDim);
  }
  vec3 col=mix(base,max(base,inkCol),uEffect);
  vec2 vq=vUv-.5; col*=1.-dot(vq,vq)*uVignette;
  col+=(hash(gl_FragCoord.xy+fract(uTime))-.5)*uGrain;
  gl_FragColor=vec4(col,1.);
}`;
