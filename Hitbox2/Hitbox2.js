/* eslint-disable require-yield, eqeqeq */

import {
  Sprite,
  Trigger,
  Watcher,
  Costume,
  Color,
  Sound,
} from "https://unpkg.com/leopard@^1/dist/index.esm.js";

export default class Hitbox2 extends Sprite {
  constructor(...args) {
    super(...args);

    this.costumes = [
      new Costume("costume1", "./Hitbox2/costumes/costume1.svg", {
        x: 28,
        y: 45,
      }),
    ];

    this.sounds = [new Sound("pop", "./Hitbox2/sounds/pop.wav")];

    this.triggers = [
      new Trigger(
        Trigger.BROADCAST,
        { name: "P2_Attack" },
        this.whenIReceiveP2Attack
      ),
      new Trigger(Trigger.GREEN_FLAG, this.whenGreenFlag),
    ];
  }

  *whenGreenFlag() {
    this.visible = false;
    while (true) {
      this.goto(
        this.sprites.Fighter2.x + (this.sprites.Fighter2.vars.facingDirection * 35),
        this.sprites.Fighter2.y
      );
      yield;
    }
  }

  *whenIReceiveP2Attack() {
    this.visible = false;
  }
}
