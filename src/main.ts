import Phaser from 'phaser';
import { MapScene } from './presentation/MapScene';
import { VisualCalibrationScene } from './presentation/VisualCalibrationScene';
import './style.css';

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
