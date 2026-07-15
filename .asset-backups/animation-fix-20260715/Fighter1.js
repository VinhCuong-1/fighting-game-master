/* eslint-disable require-yield, eqeqeq */

import {
  Sprite,
  Trigger,
  Watcher,
  Costume,
  Color,
  Sound,
} from "https://unpkg.com/leopard@^1/dist/index.esm.js";

export default class Fighter1 extends Sprite {
  constructor(...args) {
    super(...args);

    this.costumes = [
      ...[0, 1, 2, 3, 4, 5].map((frame) => new Costume(`idle-${frame}`, `./assets/demon_human_sprites/grunt2sword_Animation 1_${frame}.png`, { x: 10, y: 16 })),
      ...[0, 1, 2, 3, 4].map((frame) => new Costume(`attack-${frame}`, `./assets/demon_human_sprites/grunt2sword_attack_Animation 1_${frame}.png`, { x: 32, y: 16 })),
    ];

    this.sounds = [new Sound("Meow", "./Fighter1/sounds/Meow.wav")];

    this.triggers = [
      new Trigger(Trigger.GREEN_FLAG, this.whenGreenFlag),
    ];

    this.vars.isGrounded = 1;
    this.vars.xVel = 0;
    this.vars.yVel = 0;
    this.vars.facingDirection = 1;
    this.vars.state = "idle";
    this.vars.health = 100;
    // ... rest of constructor watchers code ...
    this.watchers.isGrounded = new Watcher({
      label: "Fighter1: is_grounded",
      style: "normal",
      visible: true,
      value: () => this.vars.isGrounded,
      x: 245,
      y: 123,
    });
    this.watchers.xVel = new Watcher({
      label: "Fighter1: x_vel",
      style: "normal",
      visible: true,
      value: () => this.vars.xVel,
      x: 245,
      y: 175,
    });
    this.watchers.yVel = new Watcher({
      label: "Fighter1: y_vel",
      style: "normal",
      visible: true,
      value: () => this.vars.yVel,
      x: 245,
      y: 149,
    });
    this.watchers.facingDirection = new Watcher({
      label: "Fighter1: facing_direction",
      style: "slider",
      visible: true,
      value: () => this.vars.facingDirection,
      setValue: (value) => {
        this.vars.facingDirection = value;
      },
      step: 1,
      min: 0,
      max: 100,
      x: 246,
      y: 97,
    });
    this.watchers.state = new Watcher({
      label: "Fighter1: state",
      style: "normal",
      visible: true,
      value: () => this.vars.state,
      x: 245,
      y: 71,
    });
    this.watchers.health = new Watcher({
      label: "Fighter1: health",
      style: "normal",
      visible: true,
      value: () => this.vars.health,
      x: 245,
      y: 45,
    });
  }

  *whenGreenFlag() {
    this.goto(-150, -120);
    this.vars.health = 100;
    this.vars.xVel = 0;
    this.vars.yVel = 0;
    this.vars.facingDirection = 1;
    this.vars.state = "idle";
    this.vars.isGrounded = 1;

    while (true) {
      const inputs = this.getInputs();
      this.runPhysics(inputs);

      // Handle Attack trigger
      if (inputs.attack && this.vars.state !== "attack" && this.vars.state !== "hit") {
        this.vars.state = "attack";
        this.broadcast("P1_Attack");
        yield* this.wait(0.15); // duration of attack
        this.vars.state = "idle";
      }

      // Check if hit by P2's hitbox
      if (this.sprites.Hitbox2.visible && this.touching(this.sprites.Hitbox2)) {
        if (this.vars.state !== "hit") {
          this.vars.state = "hit";
          this.vars.health -= 10;
          yield* this.startSound("Meow");
          this.vars.xVel = -this.vars.facingDirection * 12;
          this.vars.yVel = 4;
          yield* this.wait(0.25); // hit stun duration
          this.vars.state = "idle";
        }
      }

      // Handle auto-facing
      if (this.x < this.sprites.Fighter2.x) {
        this.vars.facingDirection = 1;
        this.direction = 90;
      } else {
        this.vars.facingDirection = -1;
        this.direction = -90;
      }

      // Costume management
      const frame = Math.floor(Date.now() / (this.vars.state === "attack" ? 75 : 120));
      this.costume = this.vars.state === "attack"
        ? `attack-${frame % 5}`
        : `idle-${frame % 6}`;

      yield;
    }
  }

  getInputs() {
    const slot = this.stage.vars.myPlayerSlot;
    if (slot === 0 || slot === 1) {
      return {
        left: this.keyPressed("a") ? 1 : 0,
        right: this.keyPressed("d") ? 1 : 0,
        jump: this.keyPressed("w") ? 1 : 0,
        attack: this.keyPressed("f") ? 1 : 0,
      };
    } else {
      return {
        left: this.stage.vars.p1Inputs.left || 0,
        right: this.stage.vars.p1Inputs.right || 0,
        jump: this.stage.vars.p1Inputs.jump || 0,
        attack: this.stage.vars.p1Inputs.attack || 0,
      };
    }
  }

  runPhysics(inputs) {
    if (this.vars.state === "hit") {
      this.vars.yVel -= 1.5;
      this.x += this.vars.xVel;
      this.y += this.vars.yVel;
      this.vars.xVel *= 0.85;
    } else {
      if (inputs.left) {
        this.vars.xVel -= 2.5;
      }
      if (inputs.right) {
        this.vars.xVel += 2.5;
      }

      this.vars.xVel *= 0.75;
      this.x += this.vars.xVel;

      this.vars.yVel -= 1.5;

      if (inputs.jump && this.vars.isGrounded === 1) {
        this.vars.yVel = 18;
        this.vars.isGrounded = 0;
      }

      this.y += this.vars.yVel;
    }

    if (this.y < -120) {
      this.y = -120;
      this.vars.yVel = 0;
      this.vars.isGrounded = 1;
    } else {
      this.vars.isGrounded = 0;
    }

    if (this.x > 230) this.x = 230;
    if (this.x < -230) this.x = -230;
  }
}
