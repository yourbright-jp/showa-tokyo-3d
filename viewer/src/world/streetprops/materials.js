import * as THREE from 'three';
import { canvasTexture, makeValueNoise, paintPixels, JP_FONT } from '../../core/textures.js';

// Shared materials for street props. Weathering (grime, rain streaks, dust on top faces, rust
// on metal) is computed in the fragment shader from world position, so merged props never
// show texture seams or identical dirt. Emission is per vertex (aEmit) and scaled by the look.

let NOISE = null;
function noiseTexture(rng) {
  if (NOISE) return NOISE;
  const N = makeValueNoise(rng, 256);
  NOISE = canvasTexture(256, 256, (g, w, h) => {
    paintPixels(g, w, h, (u, v) => {
      const a = N.fbm(u * 8, v * 8, 5, 8);
      const b = N.fbm(u * 16 + 7.3, v * 16 + 1.1, 4, 16);
      const c = N.fbm(u * 32 + 3.7, v * 4 + 9.2, 3, 32); // anisotropic (streak) channel
      const d = N.fbm(u * 24 + 11.1, v * 24 + 5.5, 4, 24);
      return [a * 255, b * 255, c * 255, d * 255];
    });
  }, { srgb: false, repeat: [1, 1] });
  NOISE.premultiplyAlpha = false;
  return NOISE;
}

function emitScale(ctx) {
  const night = ctx.look && ctx.look.name === 'neon-night';
  return { night: night ? 1 : 0, day: night ? 0 : 1 };
}

/** Patch a MeshStandardMaterial with per-vertex PBR, weathering and emission. */
function patchWeathering(mat, ctx, { grime = 1, key = 'sp' } = {}) {
  const tex = noiseTexture(ctx.rng('streetprops/noise'));
  const es = emitScale(ctx);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: tex };
    shader.uniforms.uGrime = { value: grime };
    shader.uniforms.uNight = { value: es.night };
    shader.uniforms.uDay = { value: es.day };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aPbr; attribute vec2 aEmit;
varying vec4 vPbr; varying vec2 vEmit; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vBaseCol;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPbr = aPbr; vEmit = aEmit;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
#ifdef USE_COLOR
vBaseCol = color.rgb;
#else
vBaseCol = vec3(1.0);
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uNoise; uniform float uGrime; uniform float uNight; uniform float uDay;
varying vec4 vPbr; varying vec2 vEmit; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vBaseCol;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 emitBase = diffuseColor.rgb;
vec3 wn = normalize(vWNrm);
vec3 an = abs(wn); an /= (an.x + an.y + an.z + 1e-4);
vec4 nX = texture2D(uNoise, vWPos.zy * 0.43);
vec4 nY = texture2D(uNoise, vWPos.xz * 0.43);
vec4 nZ = texture2D(uNoise, vWPos.xy * 0.43);
vec4 nn = nX * an.x + nY * an.y + nZ * an.z;
vec4 fine = texture2D(uNoise, (vWPos.xz + vWPos.yy * vec2(0.71, -0.53)) * 2.3);
float streak = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 0.55, vWPos.y * 0.035)).b;
float wear = vPbr.z * uGrime;
float side = 1.0 - an.y;
float gr = wear * (0.62 * smoothstep(0.38, 0.82, nn.r) + 0.24 * side * smoothstep(0.55, 0.85, streak) + 0.16 * fine.g);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.46, 0.40), clamp(gr, 0.0, 0.8));
float dust = wear * smoothstep(0.55, 0.95, wn.y) * (0.35 + 0.5 * nn.g);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.31, 0.27), clamp(dust * 0.55, 0.0, 0.6));
float rustAmt = wear * vPbr.y * smoothstep(0.58, 0.78, nn.a * 0.75 + fine.r * 0.35);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.085, 0.035) * (0.7 + 0.6 * fine.b), clamp(rustAmt, 0.0, 0.85));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(vPbr.x + rustAmt * 0.35 + gr * 0.18 + (fine.a - 0.5) * 0.08 * wear, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = clamp(vPbr.y * (1.0 - rustAmt) * (1.0 - gr * 0.4), 0.0, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += emitBase * (vEmit.x * uNight + vEmit.y * uDay);`);
  };
  mat.customProgramCacheKey = () => `streetprops-${key}`;
  return mat;
}

export function makeMaterials(ctx, atlasTex) {
  const opaque = patchWeathering(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), ctx, { key: 'opaque' });
  const atlas = patchWeathering(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide }), ctx, { key: 'atlas', grime: 0.8 });
  const foliage = patchWeathering(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }), ctx, { key: 'foliage', grime: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x4f5c60, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.0 });
  const decal = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, map: contactTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: true });
  return { opaque, atlas, foliage, glass, decal };
}

function contactTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    paintPixels(g, w, h, (u, v) => {
      const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const a = Math.pow(1 - r, 1.6) * 255;
      return [255, 255, 255, a];
    });
  }, { srgb: false });
}

// ---- sign / panel atlas -----------------------------------------------------------------------
// One 1024x1024 canvas holding every printed face used by street props. Regions are in UV
// (0..1, v up). Only generic regulatory symbols and generic words are drawn (no brands).

export const ATLAS = {};
function region(name, x, y, w, h) {
  // canvas pixel rect -> uv rect (v flipped)
  ATLAS[name] = [x / 1024, 1 - (y + h) / 1024, (x + w) / 1024, 1 - y / 1024];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function grungeRect(g, rng, x, y, w, h, alpha = 0.18) {
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${60 + rng() * 40},${50 + rng() * 30},${30 + rng() * 20},${rng() * alpha})`;
    const rw = rng() * w * 0.4, rh = rng() * h * 0.3;
    g.fillRect(x + rng() * (w - rw), y + rng() * (h - rh), rw, rh);
  }
}

function drawPerson(g, cx, top, s, fill) {
  // simple road-sign pictogram figure (head + body + legs), s = figure height
  g.fillStyle = fill;
  g.beginPath(); g.arc(cx, top + s * 0.09, s * 0.085, 0, Math.PI * 2); g.fill();
  roundRect(g, cx - s * 0.11, top + s * 0.2, s * 0.22, s * 0.38, s * 0.05); g.fill();
  g.fillRect(cx - s * 0.1, top + s * 0.52, s * 0.085, s * 0.46);
  g.fillRect(cx + s * 0.015, top + s * 0.52, s * 0.085, s * 0.46);
}

export function makeAtlas(ctx) {
  const rng = ctx.rng('streetprops/atlas');
  const tex = canvasTexture(1024, 1024, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 1024, 1024);
    // 1) pedestrian-only (blue disc, white adult + child, holding hands)
    {
      const x = 0, y = 0, s = 128;
      g.clearRect(x, y, s, s);
      g.fillStyle = '#f2f2ee'; g.beginPath(); g.arc(x + 64, y + 64, 63, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d4f9c'; g.beginPath(); g.arc(x + 64, y + 64, 58, 0, Math.PI * 2); g.fill();
      drawPerson(g, x + 52, y + 26, 78, '#f4f4f0');
      drawPerson(g, x + 82, y + 50, 54, '#f4f4f0');
      g.fillStyle = '#f4f4f0'; g.fillRect(x + 58, y + 62, 22, 5);
      grungeRect(g, rng, x + 10, y + 10, 108, 108, 0.1);
      region('pedestrian', x, y, s, s);
    }
    // 2) no-entry for vehicles (red disc, white bar)
    {
      const x = 128, y = 0;
      g.clearRect(x, y, 128, 128);
      g.fillStyle = '#efefe9'; g.beginPath(); g.arc(x + 64, y + 64, 63, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c1271e'; g.beginPath(); g.arc(x + 64, y + 64, 58, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2f2ec'; g.fillRect(x + 22, y + 55, 84, 18);
      grungeRect(g, rng, x + 10, y + 10, 108, 108, 0.1);
      region('noEntry', x, y, 128, 128);
    }
    // 3) speed limit 40 (red ring, white field, blue numerals)
    {
      const x = 256, y = 0;
      g.clearRect(x, y, 128, 128);
      g.fillStyle = '#c4281f'; g.beginPath(); g.arc(x + 64, y + 64, 63, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f1f0ea'; g.beginPath(); g.arc(x + 64, y + 64, 47, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1f4a96'; g.font = `bold 58px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('40', x + 64, y + 68);
      region('speed40', x, y, 128, 128);
    }
    // 4) no parking (blue disc, red ring, red slash)
    {
      const x = 384, y = 0;
      g.clearRect(x, y, 128, 128);
      g.fillStyle = '#c4281f'; g.beginPath(); g.arc(x + 64, y + 64, 63, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1f4f9a'; g.beginPath(); g.arc(x + 64, y + 64, 50, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#c4281f'; g.lineWidth = 12; g.beginPath(); g.moveTo(x + 30, y + 30); g.lineTo(x + 98, y + 98); g.stroke();
      region('noParking', x, y, 128, 128);
    }
    // 5) auxiliary plate: 歩行者専用 (white plate, black text)
    {
      const x = 512, y = 0, w = 256, h = 80;
      g.fillStyle = '#f0efe8'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      g.fillStyle = '#1a1a1a'; g.font = `52px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('歩行者専用', x + w / 2, y + h / 2 + 2);
      grungeRect(g, rng, x, y, w, h, 0.08);
      region('plateHokousha', x, y, w, h);
    }
    // 6) auxiliary plate: 車両進入禁止 is implied by the disc; time plate for the street
    {
      const x = 768, y = 0, w = 256, h = 80;
      g.fillStyle = '#f0efe8'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      g.fillStyle = '#1a1a1a'; g.font = `48px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('自転車を除く', x + w / 2, y + h / 2 + 2);
      region('plateExceptBikes', x, y, w, h);
    }
    // 7) orange portable barricade face with pedestrian disc and 歩行者専用
    {
      const x = 512, y = 80, w = 256, h = 128;
      g.fillStyle = '#e39a2a'; g.fillRect(x, y, w, h);
      g.fillStyle = '#c7801c'; g.fillRect(x, y + h - 10, w, 10);
      g.fillStyle = '#f2f2ee'; g.beginPath(); g.arc(x + 128, y + 44, 34, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d4f9c'; g.beginPath(); g.arc(x + 128, y + 44, 31, 0, Math.PI * 2); g.fill();
      drawPerson(g, x + 121, y + 22, 40, '#f4f4f0'); drawPerson(g, x + 137, y + 34, 28, '#f4f4f0');
      g.fillStyle = '#1a1a1a'; g.font = `30px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('歩行者専用', x + 128, y + 100);
      grungeRect(g, rng, x, y, w, h, 0.2);
      region('barricade', x, y, w, h);
    }
    // 8) phone roof sign 電話 (cream panel, red text)
    {
      const x = 768, y = 80, w = 256, h = 64;
      g.fillStyle = '#efe9d6'; g.fillRect(x, y, w, h);
      g.fillStyle = '#b8241c'; g.font = `bold 46px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('電 話', x + w / 2, y + h / 2 + 2);
      region('phoneSign', x, y, w, h);
    }
    // 9) cigarette vending front (generic packs, たばこ)
    vendingCig(g, rng, 0, 128, 192, 384); region('vendCig', 0, 128, 192, 384);
    // 10) drink vending fronts (two colourways)
    vendingDrink(g, rng, 192, 128, 192, 384, '#c8302a', '#f1ece0'); region('vendDrinkRed', 192, 128, 192, 384);
    vendingDrink(g, rng, 384, 128, 192, 384, '#2a5aa8', '#eef0ea'); region('vendDrinkBlue', 384, 128, 192, 384);
    // 11) beer crate side lattice (grey base; tinted by vertex colour)
    {
      const x = 576, y = 208, w = 192, h = 96;
      g.fillStyle = '#e8e8e8'; g.fillRect(x, y, w, h);
      g.fillStyle = '#2a2a2a';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { roundRect(g, x + 12 + i * 30, y + 14 + j * 36, 22, 26, 4); g.fill(); }
      g.fillStyle = '#2a2a2a'; roundRect(g, x + 70, y + 4, 52, 8, 3); g.fill();
      region('crateSide', x, y, w, h);
    }
    // 12) cardboard side (kraft with tape and printed box rules, no text)
    {
      const x = 768, y = 144, w = 256, h = 160;
      const N = makeValueNoise(rng, 64);
      const img = g.getImageData(x, y, w, h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const n = N.fbm(i / 18, j / 18, 3);
        const k = (j * w + i) * 4;
        img.data[k] = 168 + n * 40; img.data[k + 1] = 128 + n * 30; img.data[k + 2] = 82 + n * 22; img.data[k + 3] = 255;
      }
      g.putImageData(img, x, y);
      g.fillStyle = 'rgba(200,180,140,0.85)'; g.fillRect(x + w / 2 - 14, y, 28, h);
      g.strokeStyle = 'rgba(70,50,30,0.55)'; g.lineWidth = 3; g.strokeRect(x + 30, y + 40, 80, 60);
      g.fillStyle = 'rgba(70,50,30,0.45)'; g.fillRect(x + 150, y + 50, 70, 8); g.fillRect(x + 150, y + 66, 50, 6);
      region('cardboard', x, y, w, h);
    }
    // 13) concrete bin label くず入れ
    {
      const x = 576, y = 304, w = 192, h = 64;
      g.fillStyle = '#8f8b84'; g.fillRect(x, y, w, h);
      grungeRect(g, rng, x, y, w, h, 0.25);
      g.fillStyle = '#1e1e1e'; g.font = `40px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('くず入れ', x + w / 2, y + h / 2 + 2);
      region('binLabel', x, y, w, h);
    }
    // 14) pole advertisement plates (generic category words only)
    poleAd(g, rng, 768, 304, 64, 224, ['内科', '小児科'], '#1f4f9a', 'この先'); region('poleAdA', 768, 304, 64, 224);
    poleAd(g, rng, 832, 304, 64, 224, ['質'], '#b3261e', '右へ50m'); region('poleAdB', 832, 304, 64, 224);
    poleAd(g, rng, 896, 304, 64, 224, ['歯科'], '#1d6b3a', 'この先'); region('poleAdC', 896, 304, 64, 224);
    poleAd(g, rng, 960, 304, 64, 224, ['理容'], '#1f4f9a', '左へ'); region('poleAdD', 960, 304, 64, 224);
    // 15) licence plate (white, green characters), small
    {
      const x = 576, y = 368, w = 128, h = 64;
      g.fillStyle = '#eeeee6'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#2f6b3a'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
      g.fillStyle = '#2f6b3a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `16px ${JP_FONT}`; g.fillText('品川 55', x + 64, y + 16);
      g.font = `bold 30px ${JP_FONT}`; g.fillText('12-07', x + 70, y + 44);
      region('plateCar', x, y, w, h);
    }
    // 16) taxi licence plate (green, white characters)
    {
      const x = 704, y = 368, w = 64, h = 32;
      g.fillStyle = '#2d6a3c'; g.fillRect(x, y, w, h);
      g.fillStyle = '#efefe6'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold 15px ${JP_FONT}`; g.fillText('34-81', x + 34, y + 20);
      region('plateTaxi', x, y, w, h);
    }
    // 17) fire hydrant sign 消火栓 (red, white text, vertical)
    {
      const x = 576, y = 432, w = 48, h = 128;
      g.fillStyle = '#c3281f'; g.fillRect(x, y, w, h);
      g.fillStyle = '#f3f0e8'; g.font = `30px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      ['消', '火', '栓'].forEach((c, i) => g.fillText(c, x + w / 2, y + 24 + i * 38));
      region('hydrant', x, y, w, h);
    }
    // 18) blank enamel (pole number plate)
    {
      const x = 624, y = 432, w = 48, h = 64;
      g.fillStyle = '#e8e6dc'; g.fillRect(x, y, w, h);
      g.fillStyle = '#333'; g.fillRect(x + 8, y + 14, 32, 5); g.fillRect(x + 8, y + 30, 26, 5); g.fillRect(x + 8, y + 46, 30, 5);
      region('poleTag', x, y, w, h);
    }
    // 19) traffic signal pedestrian heads: green walking (lit) and red standing (unlit)
    {
      const x = 672, y = 432, s = 64;
      g.fillStyle = '#101010'; g.fillRect(x, y, s * 2, s);
      // green walking figure
      g.fillStyle = '#3fd29a';
      g.beginPath(); g.arc(x + 32, y + 12, 6, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(x + 32, y + 32); g.rotate(0.12); g.fillRect(-5, -14, 10, 22); g.restore();
      g.save(); g.translate(x + 30, y + 46); g.rotate(0.35); g.fillRect(-3, -6, 6, 18); g.restore();
      g.save(); g.translate(x + 36, y + 46); g.rotate(-0.35); g.fillRect(-3, -6, 6, 18); g.restore();
      // dim red standing figure
      g.fillStyle = '#4a1210';
      g.beginPath(); g.arc(x + 96, y + 12, 6, 0, Math.PI * 2); g.fill();
      g.fillRect(x + 90, y + 20, 12, 22); g.fillRect(x + 90, y + 42, 5, 18); g.fillRect(x + 97, y + 42, 5, 18);
      region('pedGreen', x, y, s, s); region('pedRedOff', x + s, y, s, s);
    }
    // 20) wire-basket mesh (alpha tested; tinted by vertex colour)
    {
      const x = 800, y = 432, w = 128, h = 96;
      g.clearRect(x, y, w, h);
      g.strokeStyle = '#e6e6e2'; g.lineWidth = 2.2;
      for (let i = 0; i <= 12; i++) { const xx = x + 2 + (i * (w - 4)) / 12; g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
      for (let j = 0; j <= 7; j++) { const yy = y + 2 + (j * (h - 4)) / 7; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
      g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      region('basket', x, y, w, h);
    }
    // 21) car grille (chrome bars on black)
    {
      const x = 928, y = 432, w = 96, h = 48;
      g.fillStyle = '#121212'; g.fillRect(x, y, w, h);
      g.fillStyle = '#c9cccc';
      for (let j = 0; j < 6; j++) g.fillRect(x + 3, y + 4 + j * 7.4, w - 6, 2.6);
      g.fillRect(x + w / 2 - 2, y + 2, 4, h - 4);
      g.strokeStyle = '#d8dada'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      region('grille', x, y, w, h);
    }
    // 22) leaf cards (alpha tested): small-leaf shrub and large rubber-plant leaves
    {
      const x = 0, y = 512, w = 256, h = 256;
      g.clearRect(x, y, w, h);
      const pal = ['#3b6a2a', '#4e7d33', '#2c5524', '#5d8a3c', '#467a30', '#6f9445', '#365f27'];
      for (let i = 0; i < 520; i++) {
        const cx = x + 10 + rng() * (w - 20), cy = y + 10 + rng() * (h - 20);
        const dx = (cx - x - w / 2) / (w / 2), dy = (cy - y - h / 2) / (h / 2);
        if (dx * dx + dy * dy > 0.95) continue;
        const a = rng() * Math.PI * 2, L = 7 + rng() * 9, W2 = L * (0.38 + rng() * 0.2);
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.fillStyle = pal[Math.floor(rng() * pal.length)];
        g.beginPath(); g.ellipse(0, 0, L, W2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,230,0.12)'; g.beginPath(); g.ellipse(-L * 0.2, -W2 * 0.3, L * 0.6, W2 * 0.4, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(20,40,10,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
        g.restore();
      }
      region('leafSmall', x + 10, y + 10, w - 20, h - 20);
    }
    {
      const x = 256, y = 512, w = 256, h = 256;
      g.clearRect(x, y, w, h);
      const pal = ['#2a4f22', '#355e2a', '#244620', '#3f6a2e'];
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rng() * 0.3;
        const r0 = 20 + rng() * 70;
        const cx = x + w / 2 + Math.cos(a) * r0, cy = y + h / 2 + Math.sin(a) * r0;
        const L = 26 + rng() * 14, W2 = L * 0.45;
        g.save(); g.translate(cx, cy); g.rotate(a + (rng() - 0.5) * 0.6);
        g.fillStyle = pal[Math.floor(rng() * pal.length)];
        g.beginPath(); g.ellipse(0, 0, L, W2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(230,255,210,0.16)'; g.beginPath(); g.ellipse(-L * 0.15, -W2 * 0.25, L * 0.7, W2 * 0.45, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(200,220,170,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
        g.restore();
      }
      region('leafBig', x + 10, y + 10, w - 20, h - 20);
    }
  }, { anisotropy: 8 });
  return tex;
}

function poleAd(g, rng, x, y, w, h, words, col, sub) {
  g.fillStyle = '#efece2'; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w, 8); g.fillRect(x, y + h - 8, w, 8);
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  let cy = y + 30;
  for (const wd of words) {
    for (const ch of wd) { g.font = `bold 34px ${JP_FONT}`; g.fillText(ch, x + w / 2, cy); cy += 36; }
    cy += 6;
  }
  g.font = `16px ${JP_FONT}`;
  g.fillStyle = '#b8261e';
  let sy = y + h - 22 - (sub.length - 1) * 16;
  for (const ch of sub) { g.fillText(ch === 'm' ? 'm' : ch, x + w / 2, sy); sy += 16; }
  grungeRect(g, rng, x, y, w, h, 0.22);
}

function vendingCig(g, rng, x, y, w, h) {
  g.fillStyle = '#e9e4d6'; g.fillRect(x, y, w, h);
  // header band
  g.fillStyle = '#b52a22'; g.fillRect(x, y, w, 52);
  g.fillStyle = '#f6f0e2'; g.font = `bold 36px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('たばこ', x + w / 2, y + 28);
  // display window with generic packs (colour blocks, no lettering)
  g.fillStyle = '#2b2d2c'; g.fillRect(x + 12, y + 62, w - 24, 170);
  const packCols = ['#f2f0e8', '#1d3f8a', '#c8a43a', '#7a1f1c', '#2f6e47', '#d9d4c2', '#3a6fb0', '#a8322a', '#efe3b0', '#5a3b23'];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    const px = x + 18 + c * 27, py = y + 70 + r * 40;
    g.fillStyle = packCols[Math.floor(rng() * packCols.length)];
    g.fillRect(px, py, 21, 28);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py + 18, 21, 3);
    g.fillStyle = '#ddd'; g.fillRect(px + 6, py + 32, 9, 4); // button
  }
  // coin panel
  g.fillStyle = '#9a9890'; g.fillRect(x + 12, y + 244, w - 24, 70);
  g.fillStyle = '#333'; g.fillRect(x + 130, y + 256, 10, 26); g.fillRect(x + 30, y + 262, 60, 10);
  // take-out tray
  g.fillStyle = '#1e1e1e'; g.fillRect(x + 40, y + 326, w - 80, 40);
  grungeRect(g, rng, x, y, w, h, 0.12);
}

function vendingDrink(g, rng, x, y, w, h, body, panel) {
  g.fillStyle = body; g.fillRect(x, y, w, h);
  // sample window with cans (generic coloured cans, no lettering)
  g.fillStyle = panel; g.fillRect(x + 12, y + 18, w - 24, 150);
  const canCols = ['#d23a2e', '#f0c63a', '#3a7d44', '#e46f22', '#2f62b5', '#f2f0ea', '#8a3b2a', '#62b0d8'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    const px = x + 22 + c * 31, py = y + 26 + r * 70;
    const cc = canCols[Math.floor(rng() * canCols.length)];
    g.fillStyle = cc; roundRect(g, px, py, 22, 42, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(px + 3, py + 4, 4, 34);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py + 14, 22, 6);
    g.fillStyle = '#e8e8e2'; roundRect(g, px + 4, py + 48, 14, 9, 2); g.fill();
  }
  g.fillStyle = '#f5f1e6'; g.font = `bold 34px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ジュース', x + w / 2, y + 196);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 12, y + 222, w - 24, 4);
  // coin + return
  g.fillStyle = '#a7a59d'; g.fillRect(x + 120, y + 236, 50, 74);
  g.fillStyle = '#222'; g.fillRect(x + 140, y + 246, 8, 22); g.fillRect(x + 130, y + 284, 30, 14);
  // can outlet
  g.fillStyle = '#151515'; g.fillRect(x + 24, y + 320, w - 48, 46);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + h - 14, w, 14);
  grungeRect(g, rng, x, y, w, h, 0.14);
}
