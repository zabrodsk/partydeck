import {fan} from './vendor/card-motion/layout.js';

// Fan geometry and pointer tilt adapted from card-motion 0.2.0 (MIT).
// https://cards.franpiaggio.com — license retained in vendor/card-motion.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const handFan = fan({tilt:8,dip:0});
let previous = new Map(), previousHand = '', previousTurn = '', previousResult = '';
let outgoing = [];

export function captureMotion(root) {
  outgoing.forEach(node => { window.gsap?.killTweensOf(node); node.remove(); }); outgoing = [];
  previous = new Map();
  const gsap = window.gsap;
  for (const node of root.querySelectorAll('[data-card]')) {
    if (node.closest('.hero-cards')) continue;
    const rect = node.getBoundingClientRect();
    const moving = gsap?.isTweening(node);
    previous.set(node.dataset.card, {
      rect, publicCard: !!node.closest('.table-stage'),
      clone: !reduced() && node.closest('.table-stage') ? node.cloneNode(true) : null,
      moving, x: moving ? gsap.getProperty(node,'x') : 0,
      y: moving ? gsap.getProperty(node,'y') : 0,
      rotation: moving ? gsap.getProperty(node,'rotation') : 0,
      scale: moving ? gsap.getProperty(node,'scaleX') : 1,
      rotationY: moving ? gsap.getProperty(node,'rotationY') : 0,
    });
  }
  // No detached cards or obsolete timelines survive a room update.
  gsap?.killTweensOf([...root.querySelectorAll('*')].filter(node=>!node.closest('.hero-cards')));
}

export function animateCards(root, room) {
  const gsap = window.gsap;
  const hand = room ? `${room.code}:${room.game}:${room.handNumber}` : '';
  const newHand = hand !== previousHand;
  const turn = room?.activeId || '';
  const result = room?.phase === 'complete' ? hand : '';
  const turnChanged = turn && turn !== previousTurn;
  const resultChanged = result && result !== previousResult;
  previousHand = hand; previousTurn = turn; previousResult = result;
  if (!gsap || reduced()) return;
  const nodes = [...root.querySelectorAll('[data-card]')].filter(node=>!node.closest('.landing'));
  const stage = root.querySelector('.table-stage');
  const stageBox = stage?.getBoundingClientRect();
  const center = stageBox ? {x:stageBox.x+stageBox.width/2,y:stageBox.y+stageBox.height/2} : null;
  const keys = new Set(nodes.map(node => node.dataset.card));
  if (center) for (const [key, old] of previous) {
    if (!old.clone || (!newHand && keys.has(key))) continue;
    const node = old.clone, box = old.rect;
    node.removeAttribute('data-card'); node.setAttribute('aria-hidden','true');
    node.className = 'card collected-card';
    node.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;pointer-events:none;z-index:20;margin:0;`;
    document.body.append(node); outgoing.push(node);
    gsap.to(node,{x:center.x-box.x-box.width/2,y:center.y-box.y-box.height/2,scale:.3,opacity:0,duration:.26,ease:'power3.in',onComplete:()=>node.remove()});
  }
  let dealt = 0;
  for (const node of nodes) {
    const old = previous.get(node.dataset.card);
    const fresh = !old || (newHand && !!room);
    const target = {x:0,y:0,rotation:0,rotationY:0,scale:1,duration:.45,ease:'back.out(1.15)',clearProps:'transform'};
    if (!fresh) {
      if (old.moving) gsap.fromTo(node,{x:old.x,y:old.y,rotation:old.rotation,rotationY:old.rotationY,scale:old.scale},{...target,duration:.25});
      continue;
    }
    if (node.closest('.table-stage') && center) {
      const box = node.getBoundingClientRect();
      const board = !!node.closest('.board-cards');
      gsap.fromTo(node,{x:board?0:center.x-box.x-box.width/2,y:board?-24:center.y-box.y-box.height/2,scale:board ? .97 : .55,rotation:board?0:-12,rotationY:board?65:0},{...target,delay:(newHand ? .2 : 0)+dealt++*.055});
    } else if (node.closest('.own-cards')) {
      const siblings = [...node.parentElement.querySelectorAll('.card')], index = siblings.indexOf(node);
      const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
      const slot = handFan(index,siblings.length,{anchor:{x:0,y:0},width:parent.width});
      gsap.fromTo(node,{x:parent.x+parent.width/2-box.x-box.width/2,y:26,rotation:-slot.rotation,scale:.96},{...target,delay:index*.08});
    } else if (!node.closest('.deck-grid')) {
      gsap.fromTo(node,{y:12,rotation:2},{...target,duration:.4});
    }
  }
  const active = root.querySelectorAll('.seat.active .seat-meta,.hand-status.your-turn');
  if (turnChanged && active.length) gsap.fromTo(active,{y:4},{y:0,duration:.3,clearProps:'transform'});
  if (resultChanged) gsap.fromTo(root.querySelectorAll('.result-summary'),{y:14,scale:.98},{y:0,scale:1,duration:.4,ease:'power3.out',clearProps:'transform'});

}

export function revealMotion(cards, revealing) {
  if (!window.gsap || reduced()) return;
  window.gsap.fromTo(cards,{rotationY:revealing?-70:35,y:revealing?5:0},{rotationY:0,y:0,duration:revealing ? .3 : .18,stagger:revealing ? .035 : 0,ease:'power2.out',clearProps:'transform'});
}

matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{
  if(!event.matches || !window.gsap)return;
  const nodes=document.querySelectorAll('.card,.result-summary,.seat-meta,.hand-status');
  window.gsap.killTweensOf(nodes);window.gsap.set(nodes,{clearProps:'transform'});
  outgoing.forEach(node=>node.remove());outgoing=[];
});
