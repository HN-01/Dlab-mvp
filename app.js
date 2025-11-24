// app.js
// DLab WebXR Chemistry prototype logic
AFRAME.registerComponent('pourable', {
  schema: { capacity: {type: 'number', default: 50}, amount: {type:'number', default:0}, chem: {type: 'string', default: 'water'} },
  init: function(){
    this.el.addEventListener('grab-start', ()=> { /* highlight */ this.el.setAttribute('scale','1.02 1.02 1.02'); });
    this.el.addEventListener('grab-end', ()=> { this.el.setAttribute('scale','1 1 1'); });
    // pouring detection: ray from object down to beaker within short distance while grabbed
    this.pouring = false;
    this.lastPourTime = 0;
  },
  tick: function(time, dt){
    // if grabbed and tilted downwards, pour into nearest beaker
    const grabbed = this.el.components['super-hands'] ? this.el.components['super-hands'].isHeld : false;
    // fallback: super-hands sets grabbed state via other events; we'll use attribute set by community,
    // so instead detect a 'held' flag (most controllers set hand state)
    const rotation = this.el.object3D.rotation;
    // approximate tilt: if rotated forward more than 50deg
    const tiltDeg = Math.abs(THREE.Math.radToDeg(rotation.x));
    if(tiltDeg > 45 && this.el.getAttribute('held') === true){
      // attempt pour
      const scene = this.el.sceneEl;
      const beakers = scene.querySelectorAll('[id^=beaker]');
      for(let b of beakers){
        const bPos = new THREE.Vector3(); b.object3D.getWorldPosition(bPos);
        const oPos = new THREE.Vector3(); this.el.object3D.getWorldPosition(oPos);
        const dist = bPos.distanceTo(oPos);
        if(dist < 0.45){
          // pour tiny amount frequently
          if(time - this.lastPourTime > 120){
            this.lastPourTime = time;
            this.pourInto(b, 1); // pour 1 ml unit
          }
        }
      }
    }
  },
  pourInto: function(beakerEl, amount){
    // increase beaker liquid and update color based on chem mixing
    const liquid = beakerEl.querySelector('#liquid');
    const currentHeight = parseFloat(liquid.getAttribute('height')) || 0.001;
    const addHeight = 0.004 * amount; // scale factor
    const newH = Math.min(0.2, currentHeight + addHeight);
    liquid.setAttribute('height', newH);
    // reposition liquid to sit at bottom
    liquid.setAttribute('position', {x:0, y:-0.11 + newH/2, z:0});
    // store chemical mixing info
    const chem = this.el.getAttribute('data-chem') || this.data.chem || 'water';
    // simple mixing engine
    updateBeakerChemistry(beakerEl, chem, amount);
  }
});

// helper: keep simulated composition and decide color/pH
const beakerStates = {}; // keyed by beaker id
function updateBeakerChemistry(beakerEl, chem, amount){
  const id = beakerEl.getAttribute('id');
  if(!beakerStates[id]) beakerStates[id] = {volume: 0, components: {}};
  const state = beakerStates[id];
  state.volume += amount;
  state.components[chem] = (state.components[chem] || 0) + amount;
  // compute pH-like heuristic
  const acid = (state.components['hcl']||0);
  const base = (state.components['naoh']||0);
  let pH = 7;
  if(acid > base) pH = Math.max(0.5, 7 - (acid-base)/5);
  else if(base > acid) pH = Math.min(13.5, 7 + (base-acid)/5);
  // decide color by composition priority
  let color = '#7fc8ff'; // default water cool blue
  if(state.components['phenolph'] && (base > acid)) color = '#ff88c3'; // pink in base
  if(state.components['silver'] && (state.components['salt']||0) > 0) color = '#d9d9d9';
  if(state.components['hcl'] && state.components['naoh']) color = '#bfffbf'; // neutral-ish greenish
  // apply color
  const liquid = beakerEl.querySelector('#liquid');
  liquid.setAttribute('color', color);
  // update monitor text
  const monitor = document.querySelector('#monitorText');
  let summary = `Reaction Monitor:\\nVolume: ${state.volume.toFixed(1)} ml\\npH ~ ${pH.toFixed(2)}\\nComponents: ${Object.keys(state.components).map(k=>k+':'+state.components[k]).join(', ')}`;
  monitor.setAttribute('value', summary);
}

// Spawn instrument helper
function spawnInstrument(type, chemName){
  const scene = document.querySelector('a-scene');
  if(!scene) return;
  // create a simple pipette/flask entity
  const ent = document.createElement('a-entity');
  ent.setAttribute('geometry','primitive: cylinder; radius: 0.035; height: 0.3');
  ent.setAttribute('position','0 1.2 -0.8');
  ent.setAttribute('material','color: #f2e8d8; metalness:0.1; roughness:0.6');
  ent.setAttribute('dynamic-body','mass:0.5');
  ent.setAttribute('grabbable','');
  ent.setAttribute('class','instrument');
  // custom attributes for pourable
  ent.setAttribute('data-chem', chemName || 'water');
  ent.setAttribute('held', false);
  // add listener to mark held when grabbed by super-hands
  ent.addEventListener('grab-start', function(){ ent.setAttribute('held', true); });
  ent.addEventListener('grab-end', function(){ ent.setAttribute('held', false); });
  // give it pourable behavior
  ent.setAttribute('pourable','');
  scene.appendChild(ent);
  return ent;
}

// UI bindings for desktop
window.addEventListener('DOMContentLoaded', function(){
  const spawnBtn = document.getElementById('spawnBtn');
  spawnBtn.addEventListener('click', function(){
    const chem = document.getElementById('chemicalSelect').value;
    spawnInstrument('pipette', chem);
  });

  // for convenience spawn a default pipette at load
  spawnInstrument('pipette', 'hcl');
});
