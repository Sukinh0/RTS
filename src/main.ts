import Phaser from 'phaser';
import { MapScene } from './presentation/MapScene';
import { VisualCalibrationScene } from './presentation/VisualCalibrationScene';
import { applyUiArtVariables } from './presentation/uiArt';
import './style.css';

declare const __TINY_SWORDS_INSTALLED__: boolean;

if (__TINY_SWORDS_INSTALLED__) applyUiArtVariables(document.documentElement.style, import.meta.env.BASE_URL);

const params = new URLSearchParams(window.location.search);
const fxDebug = params.has('fxdebug');
const visualDebug = params.has('visualdebug') && !fxDebug;
const unitVisualDebug = visualDebug && !params.has('assets');
const initialScene = visualDebug
  ? VisualCalibrationScene
  : MapScene;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: unitVisualDebug ? 1440 : 960,
  height: unitVisualDebug ? 810 : visualDebug ? 900 : 600,
  scene: [initialScene],
  scale: { mode: visualDebug ? Phaser.Scale.FIT : Phaser.Scale.RESIZE, parent: 'game', autoCenter: Phaser.Scale.CENTER_BOTH },
});
