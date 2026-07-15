/* eslint-disable require-yield, eqeqeq */

import {
  Stage as StageBase,
  Trigger,
  Watcher,
  Costume,
  Color,
  Sound,
} from "https://unpkg.com/leopard@^1/dist/index.esm.js";

export default class Stage extends StageBase {
  constructor(...args) {
    super(...args);

    this.costumes = [
      new Costume("backdrop1", "./Stage/costumes/backdrop1.svg", {
        x: 240,
        y: 180,
      }),
      new Costume("Blue Sky", "./Stage/costumes/Blue Sky.svg", {
        x: 240,
        y: 180,
      }),
      new Costume("Xy-grid-20px", "./Stage/costumes/Xy-grid-20px.png", {
        x: 480,
        y: 360,
      }),
      new Costume("Space", "./Stage/costumes/Space.png", { x: 480, y: 360 }),
      new Costume("Greek Theater", "./Stage/costumes/Greek Theater.png", {
        x: 480,
        y: 360,
      }),
      new Costume("backdrop2", "./Stage/costumes/backdrop2.svg", {
        x: 0,
        y: 0,
      }),
      new Costume("backdrop3", "./Stage/costumes/backdrop3.svg", {
        x: 243,
        y: 179,
      }),
      new Costume("Battleground 1", "./assets/Pixel-Art-Battlegrounds/PNG/Battleground1/Bright/Battleground1.png", { x: 960, y: 540 }),
      new Costume("Battleground 2", "./assets/Pixel-Art-Battlegrounds/PNG/Battleground2/Bright/Battleground2.png", { x: 960, y: 540 }),
      new Costume("Battleground 3", "./assets/Pixel-Art-Battlegrounds/PNG/Battleground3/Bright/Battleground3.png", { x: 960, y: 540 }),
      new Costume("Battleground 4", "./assets/Pixel-Art-Battlegrounds/PNG/Battleground4/Bright/Battleground4.png", { x: 960, y: 540 }),
    ];

    this.sounds = [new Sound("pop", "./Stage/sounds/pop.wav")];

    this.triggers = [];

    this.vars.myPlayerSlot = 0;
    this.vars.roundActive = 0;
    this.vars.p1Inputs = { left: 0, right: 0, jump: 0, attack: 0 };
    this.vars.p2Inputs = { left: 0, right: 0, jump: 0, attack: 0 };
  }
}
