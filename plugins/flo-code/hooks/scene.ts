// Soft, blurred color fields drifting slowly over a calm ground. The plain markup is the resting
// state, so it looks finished with motion reduced. Light and dark follow the color scheme.
export const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.ground { fill: #eef1f6; }
.blob { opacity: 0.55; }
.a { fill: #9cc3ff; animation: drift-a 70s ease-in-out infinite alternate; }
.b { fill: #d4bfff; animation: drift-b 55s ease-in-out infinite alternate; }
.c { fill: #a8e6d4; animation: drift-c 62s ease-in-out infinite alternate; }
.d { fill: #ffd2b8; animation: drift-d 48s ease-in-out infinite alternate; }
@media (prefers-color-scheme: dark) {
  .ground { fill: #15161a; }
  .blob { opacity: 0.32; }
  .a { fill: #2f6bd8; }
  .b { fill: #6d4fc2; }
  .c { fill: #1f8f7a; }
  .d { fill: #b8644a; }
}
@keyframes drift-a { to { transform: translate(260px, 140px) scale(1.15); } }
@keyframes drift-b { to { transform: translate(-220px, 180px) scale(0.9); } }
@keyframes drift-c { to { transform: translate(180px, -200px) scale(1.1); } }
@keyframes drift-d { to { transform: translate(-240px, -120px) scale(1.2); } }
.blob { transform-box: fill-box; transform-origin: center; }
</style>
<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="110"/></filter></defs>
<rect class="ground" width="1600" height="1000"/>
<g filter="url(#soft)">
<circle class="blob a" cx="360" cy="260" r="320"/>
<circle class="blob b" cx="1220" cy="220" r="300"/>
<circle class="blob c" cx="1100" cy="820" r="340"/>
<circle class="blob d" cx="420" cy="840" r="280"/>
</g>
</svg>`
