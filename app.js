// app.js — DLab GLB + chemistry engine + Firebase hooks (skeleton)

(async function(){

  // --- Load chemical DB ---
  async function loadChemDB(){
    const res = await fetch('chemicals.json');
    return await res.json();
  }
  const CHEMDB = await loadChemDB();

  // populate chemical select
  const chemSelect = document.getElementById('chemicalSelect');
  Object.keys(CHEMDB).forEach(k=>{
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = `${CHEMDB[k].name} (${k})`;
    chemSelect.appendChild(opt);
  });

  // --- Spawn GLB instruments ---
  function spawnGLB(amodelId, x=0, y=1.3, z=-0.8, scale=0.9, dataChem='water'){
    const scene = document.querySelector('a-scene');
    const ent = document.createElement('a-entity');
    ent.setAttribute('gltf-model', amodelId);
    ent.setAttribute('position', `${x} ${y} ${z}`);
    ent.setAttribute('scale', `${scale} ${scale} ${scale}`);
    ent.setAttribute('dynamic-body','');
    ent.classList.add('instrument');
    ent.setAttribute('data-chem', dataChem);
    // mark as grabbable: use super-hands 'grabbable' mixin
    ent.setAttribute('grabbable','');
    // add minimal pourable behavior
    ent.addEventListener('grab-start', e=> ent.setAttribute('held','true'));
    ent.addEventListener('grab-end', e=> ent.removeAttribute('held'));
    scene.appendChild(ent);
    return ent;
  }

  document.getElementById('spawnBeaker').addEventListener('click', ()=>{
    spawnGLB('#beakerGLB', 0, 1.05, -0.7, 0.9, 'water');
  });
  document.getElementById('spawnPipette').addEventListener('click', ()=>{
    const chem = chemSelect.value || 'water';
    spawnGLB('#pipetteGLB', 0.5, 1.3, -0.7, 0.6, chem);
  });
  document.getElementById('spawnBunsen').addEventListener('click', ()=>{
    spawnGLB('#bunsenGLB', -0.5, 1.05, -0.7, 0.6, 'none');
  });

  // --- Simple beaker state tracking + mixing engine ---
  const beakerStates = {}; // key by entity id
  function findBeakers(){
    return Array.from(document.querySelectorAll('a-entity')).filter(e=>{
      return e.querySelector && e.querySelector('[gltf-model="#beakerGLB"]') || e.getAttribute('id') === 'workBeaker'
    });
  }

  // Visual liquid is the plane child 'liquidVisual' for the pre-placed beaker;
  // for spawned beakers you should include GLB that has a named node 'liquid'
  function updateBeakerVisual(beakerEl, state){
    // if preplaced 'workBeaker' uses #liquidVisual
    const liquid = beakerEl.querySelector('#liquidVisual');
    if(liquid){
      const scale = Math.min(1, (state.volume/200));
      liquid.setAttribute('scale', `${1} ${1} ${1}`);
      const height = Math.min(0.18, 0.005*state.volume);
      liquid.setAttribute('geometry', `primitive: plane; width: ${0.28}; height: ${height}`);
      // set color heuristic
      const color = state.color || '#7fc8ff';
      liquid.setAttribute('material', `color: ${color}; opacity:0.95; shader:flat`);
      liquid.setAttribute('position', `0 ${-0.11 + height/2} 0.02`);
    }
  }

  function updateBeakerState(beakerEl, chem, volume){
    const id = beakerEl.getAttribute('id') || beakerEl.object3D.uuid;
    if(!beakerStates[id]) beakerStates[id] = {volume:0, components:{}};
    const st = beakerStates[id];
    st.volume += volume;
    st.components[chem] = (st.components[chem]||0) + volume;
    // compute simple pH heuristic
    const acid = (st.components['hcl']||0);
    const base = (st.components['naoh']||0);
    let pH = 7;
    if(acid>base) pH = Math.max(0.5, 7 - (acid-base)/5);
    else if(base>acid) pH = Math.min(13.5, 7 + (base-acid)/5);
    // color rules
    let color = '#7fc8ff';
    if(st.components['phenolph'] && base>acid) color='#ff88c3';
    if(st.components['agno3'] && (st.components['salt']||0)>0) color='#d9d9d9';
    if(st.components['hcl'] && st.components['naoh']) color = '#bfffbf';
    st.pH = pH; st.color=color;
    updateBeakerVisual(beakerEl, st);
    // monitor update
    document.querySelector('#monitorText').setAttribute('value',
      `Reaction Monitor:\\nVolume: ${st.volume.toFixed(1)} ml\\nEstimated pH: ${st.pH.toFixed(2)}\\nComponents: ${Object.keys(st.components).map(k=>k+':'+st.components[k]).join(', ')}`);
    // optionally auto-save state to Firebase (if enabled)
    if(typeof window.saveBeakerState === 'function') window.saveBeakerState(id, st);
  }

  // Simulate a pour event when a pipette ent is close to a beaker and tilted (in VR)
  setInterval(()=>{
    const instruments = Array.from(document.querySelectorAll('.instrument'));
    const beakers = findBeakers();
    instruments.forEach(inst=>{
      // detect held state and tilt; hack: use attribute held set in spawnGLB
      if(!inst.hasAttribute('held')) return;
      // compute world positions
      const iPos = new THREE.Vector3(); inst.object3D.getWorldPosition(iPos);
      beakers.forEach(b=>{
        const bPos = new THREE.Vector3(); b.object3D.getWorldPosition(bPos);
        if(iPos.distanceTo(bPos) < 0.45){
          // "pour" small volume
          const chem = inst.getAttribute('data-chem') || 'water';
          updateBeakerState(b, chem, 2); // pour 2 ml per tick approximated
        }
      });
    });
  }, 300); // every 300ms

  // --- Safety modal ---
  const safetyModal = document.getElementById('safetyModal');
  const safetyContent = document.getElementById('safetyContent');
  document.getElementById('safetyChk').addEventListener('change', e=>{
    if(e.target.checked){
      safetyContent.innerHTML = `<p><strong>Basic Safety:</strong></p>
        <ul>
          <li>Wear gloves & goggles.</li>
          <li>Never mix unknown reagents without supervision.</li>
          <li>Refer to MSDS for each chemical: <em>Click a chemical to view MSDS</em>.</li>
        </ul>`;
      safetyModal.classList.remove('hidden');
    } else safetyModal.classList.add('hidden');
  });
  document.getElementById('closeSafety').addEventListener('click', ()=> safetyModal.classList.add('hidden'));

  // --- MSDS viewer (simple) ---
  // We'll create a modal when user clicks a chemical option (optional)
  chemSelect.addEventListener('change', e=>{
    const k = e.target.value;
    if(!k) return;
    const info = CHEMDB[k];
    const html = `<h4>${info.name} (${k})</h4>
      <p>Formula: ${info.formula}</p>
      <p>Density: ${info.density_g_ml} g/mL</p>
      <p>Molar mass: ${info.molar_mass} g/mol</p>
      <p>Hazard: ${info.hazard}</p>
      <p><small>For full MSDS consult supplier data sheet.</small></p>`;
    safetyContent.innerHTML = html;
    safetyModal.classList.remove('hidden');
  });

  // --- Firebase skeleton (optional) ---
  // Create firebase-config-example.js with your config and include it before app.js
  if(window.firebaseConfig){
    // init firebase
    firebase.initializeApp(window.firebaseConfig);
    const db = firebase.firestore();
    window.saveBeakerState = async (id, state) => {
      try{
        await db.collection('runs').doc(id).set({...state, updatedAt: firebase.firestore.FieldValue.serverTimestamp()});
      }catch(e){
        console.warn('save fail', e);
      }
    };
    // teacher test loader / auto-grade example:
    window.createTest = async (testObj) => {
      const doc = await db.collection('tests').add({...testObj, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
      return doc.id;
    };
    window.saveStudentResult = async (testId, studentResult) => {
      await db.collection('tests').doc(testId).collection('results').add({...studentResult, ts: firebase.firestore.FieldValue.serverTimestamp()});
    };
  }

})();
