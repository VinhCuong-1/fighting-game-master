/* eslint-disable require-yield, eqeqeq */

import {
  Sprite,
  Trigger,
  Watcher,
  Costume,
  Color,
  Sound,
} from "https://unpkg.com/leopard@^1/dist/index.esm.js";

export default class Fighter2 extends Sprite {
  constructor(...args) {
    super(...args);

    this.costumes = [
      ...[0, 1, 2, 3, 4, 5].flatMap((frame) => [
        new Costume(`idle-right-${frame}`, `./assets/demon_human_sprites/demonimpmace_Animation 1_${frame}.png`, { x: 10, y: 16 }),
        new Costume(`idle-left-${frame}`, `./assets/demon_human_sprites/demonimpmace_Animation 1_${frame}_flip.png`, { x: 10, y: 16 }),
      ]),
      ...[0, 1, 2, 3].flatMap((frame) => [
        new Costume(`attack-right-${frame}`, `./assets/demon_human_sprites/demonimpmace_attack_Animation 1_${frame}.png`, { x: 32, y: 16 }),
        new Costume(`attack-left-${frame}`, `./assets/demon_human_sprites/demonimpmace_attack_Animation 1_${frame}_flip.png`, { x: 32, y: 16 }),
      ]),
      ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((frame) => [
        new Costume(`death-right-${frame}`, `./assets/demon_human_sprites/demonimpmace_death_Animation 1_${frame}.png`, { x: 32, y: 16 }),
        new Costume(`death-left-${frame}`, `./assets/demon_human_sprites/demonimpmace_death_Animation 1_${frame}_flip.png`, { x: 32, y: 16 }),
      ]),
    ];

    this.sounds = [new Sound("Meow", "./Fighter2/sounds/Meow.wav")];

    this.triggers = [
      new Trigger(Trigger.GREEN_FLAG, this.whenGreenFlag),
    ];

    this.vars.isGrounded = 1;
    this.vars.xVel = 0;
    this.vars.yVel = 0;
    this.vars.facingDirection = -1;
    this.vars.state = "idle";
    this.vars.health = 100;

    this.watchers.isGrounded = new Watcher({
      label: "Fighter2: is_grounded",
      style: "normal",
      visible: true,
      value: () => this.vars.isGrounded,
      x: 5,
      y: 123,
    });
    this.watchers.xVel = new Watcher({
      label: "Fighter2: x_vel",
      style: "normal",
      visible: true,
      value: () => this.vars.xVel,
      x: 5,
      y: 175,
    });
    this.watchers.yVel = new Watcher({
      label: "Fighter2: y_vel",
      style: "normal",
      visible: true,
      value: () => this.vars.yVel,
      x: 5,
      y: 149,
    });
    this.watchers.facingDirection = new Watcher({
      label: "Fighter2: facing_direction",
      style: "slider",
      visible: true,
      value: () => this.vars.facingDirection,
      setValue: (value) => {
        this.vars.facingDirection = value;
      },
      step: 1,
      min: -1,
      max: 1,
      x: 6,
      y: 97,
    });
    this.watchers.state = new Watcher({
      label: "Fighter2: state",
      style: "normal",
      visible: true,
      value: () => this.vars.state,
      x: 5,
      y: 71,
    });
    this.watchers.health = new Watcher({
      label: "Fighter2: health",
      style: "normal",
      visible: true,
      value: () => this.vars.health,
      x: 5,
      y: 45,
    });
  }

  *whenGreenFlag() {
    this.goto(150, -120);
    this.vars.health = 100;
    this.vars.xVel = 0;
    this.vars.yVel = 0;
    this.vars.facingDirection = -1;
    this.vars.state = "idle";
    this.vars.isGrounded = 1;

    while (true) {
      if (this.vars.state === "defeated") {
        this.updateCostume();
        yield;
        continue;
      }

      const inputs = this.getInputs();
      this.runPhysics(inputs);

      // Handle Attack trigger
      if (inputs.attack && this.vars.state !== "attack" && this.vars.state !== "hit") {
        this.vars.state = "attack";
        this.broadcast("P2_Attack");
        yield* this.wait(0.4); // show the complete attack animation
        this.vars.state = "idle";
      }

      // Check if hit by P1's hitbox
      if (this.sprites.Hitbox1.visible && this.touching(this.sprites.Hitbox1)) {
        if (this.vars.state !== "hit") {
          this.vars.state = "hit";
          this.vars.health -= 10;
          yield* this.startSound("Meow");
          this.vars.xVel = -this.vars.facingDirection * 12;
          this.vars.yVel = 4;
          yield* this.wait(0.25); // hit stun duration
          this.vars.state = this.vars.health <= 0 ? "defeated" : "idle";
        }
      }

      // Handle auto-facing
      if (this.x < this.sprites.Fighter1.x) {
        this.vars.facingDirection = 1;
        this.direction = 90;
      } else {
        this.vars.facingDirection = -1;
        this.direction = -90;
      }

      this.updateCostume();

      yield;
    }
  }

  getInputs() {
    const slot = this.stage.vars.myPlayerSlot;
    if (slot === 0 || slot === 2) {
      return {
        left: this.keyPressed("left") ? 1 : 0,
        right: this.keyPressed("right") ? 1 : 0,
        jump: this.keyPressed("up") ? 1 : 0,
        attack: this.keyPressed("j") ? 1 : 0,
      };
    } else {
      return {
        left: this.stage.vars.p2Inputs.left || 0,
        right: this.stage.vars.p2Inputs.right || 0,
        jump: this.stage.vars.p2Inputs.jump || 0,
        attack: this.stage.vars.p2Inputs.attack || 0,
      };
    }
  }

  updateCostume() {
    const side = this.vars.facingDirection === 1 ? "right" : "left";
    if (this.vars.state === "defeated") {
      this.costume = `death-${side}-${Math.min(7, Math.floor(Date.now() / 90) % 8)}`;
      return;
    }

    const frame = Math.floor(Date.now() / (this.vars.state === "attack" ? 75 : 120));
    this.costume = this.vars.state === "attack"
      ? `attack-${side}-${frame % 4}`
      : `idle-${side}-${frame % 6}`;
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
