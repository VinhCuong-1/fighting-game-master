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
      ...[0, 1, 2, 3, 4, 5].flatMap((frame) => [
        new Costume(`idle-right-${frame}`, `./assets/demon_human_sprites/grunt2sword_Animation 1_${frame}.png`, { x: 10, y: 16 }),
        new Costume(`idle-left-${frame}`, `./assets/demon_human_sprites/grunt2sword_Animation 1_${frame}_flip.png`, { x: 10, y: 16 }),
      ]),
      ...[0, 1, 2, 3, 4].flatMap((frame) => [
        new Costume(`attack-right-${frame}`, `./assets/demon_human_sprites/grunt2sword_attack_Animation 1_${frame}.png`, { x: 32, y: 16 }),
        new Costume(`attack-left-${frame}`, `./assets/demon_human_sprites/grunt2sword_attack_Animation 1_${frame}_flip.png`, { x: 32, y: 16 }),
      ]),
      ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((frame) => [
        new Costume(`death-right-${frame}`, `./assets/demon_human_sprites/grunt2sword_death_Animation 1_${frame}.png`, { x: 32, y: 16 }),
        new Costume(`death-left-${frame}`, `./assets/demon_human_sprites/grunt2sword_death_Animation 1_${frame}_flip.png`, { x: 32, y: 16 }),
      ]),
    ];

    this.sounds = [
      new Sound("Meow", "./Fighter1/sounds/Meow.wav"),
      new Sound("Human Attack", "./assets/sounds/humanAttackSound.wav"),
    ];

    this.triggers = [
      new Trigger(Trigger.GREEN_FLAG, this.whenGreenFlag),
    ];

    this.vars.isGrounded = 1;
    this.vars.xVel = 0;
    this.vars.yVel = 0;
    this.vars.facingDirection = 1;
    this.vars.state = "idle";
    this.vars.health = 100;
    this._attackEndsAt = 0;
    this._defeatStartedAt = 0;
    this._hitEndsAt = 0;
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
      if (this.vars.state === "defeated") {
        this.updateCostume();
        yield;
        continue;
      }

      if (this.vars.state === "hit" && Date.now() >= this._hitEndsAt) {
        if (this.vars.health <= 0) {
          this.vars.state = "defeated";
          this._defeatStartedAt = Date.now();
        } else {
          this.vars.state = "idle";
        }
      }

      const inputs = this.getInputs();
      this.runPhysics(inputs);

      // Run a non-blocking attack so every animation frame is rendered.
      if (inputs.attack && this.vars.state !== "attack" && this.vars.state !== "hit") {
        this.vars.state = "attack";
        this._attackEndsAt = Date.now() + 400;
        this.broadcast("P1_Attack");
        // Fire-and-forget — yield* startSound can hang the sprite loop if the wav fails to load.
        this.startSound("Human Attack");
        this.tryHitOpponent();
      }
      if (this.vars.state === "attack" && Date.now() >= this._attackEndsAt) {
        this.vars.state = "idle";
      }

      // Handle auto-facing
      if (this.x < this.sprites.Fighter2.x) {
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
    if (!this.stage.vars.roundActive) {
      return { left: 0, right: 0, jump: 0, attack: 0 };
    }
    const slot = Number(this.stage.vars.myPlayerSlot);
    // Local when slot is 1 (or unset/invalid). Remote when this client is player 2.
    if (slot !== 2) {
      return {
        left: this.keyPressed("a") ? 1 : 0,
        right: this.keyPressed("d") ? 1 : 0,
        jump: this.keyPressed("w") ? 1 : 0,
        attack: this.keyPressed("j") ? 1 : 0,
      };
    }
    const remote = this.stage.vars.p1Inputs || {};
    return {
      left: remote.left || 0,
      right: remote.right || 0,
      jump: remote.jump || 0,
      attack: remote.attack || 0,
    };
  }

  updateCostume() {
    const side = this.vars.facingDirection === 1 ? "right" : "left";
    if (this.vars.state === "defeated") {
      this.costume = `death-${side}-${Math.min(7, Math.floor((Date.now() - this._defeatStartedAt) / 90))}`;
      return;
    }

    const frame = Math.floor(Date.now() / (this.vars.state === "attack" ? 75 : 120));
    this.costume = this.vars.state === "attack"
      ? `attack-${side}-${frame % 5}`
      : `idle-${side}-${frame % 6}`;
  }

  tryHitOpponent() {
    const opponent = this.sprites.Fighter2;
    if (opponent.vars.state === "hit" || opponent.vars.state === "defeated") return;
    if (Math.abs(this.x - opponent.x) > 85 || Math.abs(this.y - opponent.y) > 70) return;
    opponent.receiveHit(this.vars.facingDirection);
  }

  receiveHit(attackerDirection) {
    if (this.vars.state === "hit" || this.vars.state === "defeated") return;
    this.vars.state = "hit";
    this.vars.health = Math.max(0, this.vars.health - 10);
    this.vars.xVel = attackerDirection * 12;
    this.vars.yVel = 4;
    this._hitEndsAt = Date.now() + 250;
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
