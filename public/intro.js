(()=>{'use strict';
  // The intro is the FIRST visible frame. Never expose the homepage before it.
  const scene=document.getElementById('gbIntro');if(!scene)return;
  const reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish=()=>{if(scene.classList.contains('gb-intro-out'))return;
    scene.classList.add('gb-intro-out');window.setTimeout(()=>{scene.hidden=true;document.body.classList.remove('gb-intro-active');},reduced?0:490);
  };
  document.body.classList.add('gb-intro-active');
  if(reduced){finish();return;}
  window.setTimeout(finish,2200);
})();
