/* eslint-disable require-yield, eqeqeq */

import {
  Sprite,
  Trigger,
  Watcher,
  Costume,
  Color,
  Sound,
} from "https://unpkg.com/leopard@^1/dist/index.esm.js";

export default class Hitbox1 extends Sprite {
  constructor(...args) {
    super(...args);

    this.costumes = [
      new Costume("costume1", "./Hitbox1/costumes/costume1.svg", {
        x: 28,
        y: 45,
      }),
    ];

    this.sounds = [new Sound("pop", "./Hitbox1/sounds/pop.wav")];

    this.triggers = [
      new Trigger(
        Trigger.BROADCAST,
        { name: "P1_Attack" },
        this.whenIReceiveP1Attack
      ),
      new Trigger(Trigger.GREEN_FLAG, this.whenGreenFlag),
    ];
  }

  *whenGreenFlag() {
    this.visible = false;
    while (true) {
      this.goto(
        this.sprites.Fighter1.x + (this.sprites.Fighter1.vars.facingDirection * 35),
        this.sprites.Fighter1.y
      );
      yield;
    }
  }

  *whenIReceiveP1Attack() {
    this.visible = true;
    yield* this.wait(0.1);
    this.visible = false;
  }
}
