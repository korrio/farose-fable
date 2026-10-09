// Brand intro while the globe loads: the ไกลบ้าน Lottie plays its intro once and
// then loops until app.js calls FAROSE_LOADER.done(). The loader never cuts the
// intro short, so the logo always lands before the page fades in.
(() => {
  'use strict';
  const loader = document.getElementById('loader');
  const box = document.getElementById('loaderLogo');
  let introDone = false;
  let onHide = null;
  let anim = null;

  const hide = () => {
    if (loader.classList.contains('done')) return;
    loader.classList.add('done');
    if (onHide) onHide();
    // stop drawing once the fade-out (1s, see #loader in style.css) is over
    setTimeout(() => anim && anim.destroy(), 1100);
  };
  const fallback = () => {
    introDone = true;
    box.classList.add('fallback');
    if (onHide) hide();
  };

  window.FAROSE_LOADER = {
    // cb runs when the loader starts fading out
    done(cb) {
      onHide = cb || (() => {});
      if (introDone) hide();
      // never hold the page hostage to a slow or stuck animation
      else setTimeout(hide, 4000);
    },
  };

  if (!window.lottie) return fallback();
  anim = lottie.loadAnimation({
    container: box,
    renderer: 'svg',
    loop: false,
    autoplay: false,
    path: 'assets/farose-loading.json',
  });
  anim.addEventListener('DOMLoaded', () => anim.playSegments([0, 90], true));
  anim.addEventListener('data_failed', fallback);
  anim.addEventListener('complete', () => {
    introDone = true;
    if (onHide) return hide();
    anim.loop = true;
    anim.playSegments([90, 210], true);
  });
})();
