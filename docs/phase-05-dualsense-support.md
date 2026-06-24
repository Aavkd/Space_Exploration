# Phase 05 Prep - DualSense Gamepad Support

This pre-phase pass adds browser Gamepad API support for the PS5 DualSense /
Wireless Controller while keeping the existing keyboard and mouse controls.

## Mapping

| State | DualSense input | Action |
| --- | --- | --- |
| Walking | Left stick | Move / strafe |
| Walking | Right stick | Camera look |
| Walking | Triangle | Contextual interact |
| Piloting | L2 / R2 | Reverse / forward thrust |
| Piloting | L1 / R1 | Yaw left / right |
| Piloting | Left stick vertical | Pitch |
| Piloting | Left stick horizontal | Roll |
| Piloting | Right stick | Camera / head look |
| Piloting | D-pad left / right | Strafe left / right |
| Piloting | D-pad up / down | Lift up / down |
| Piloting | Cross | Boost |
| Piloting | Circle | Airbrake |
| Piloting | Square | Toggle inertial dampeners |
| Piloting | Triangle | Leave controls |
| EVA | Left stick | Forward / strafe |
| EVA | Right stick | Camera look |
| EVA | D-pad up / down | Vertical float |
| EVA | Cross | Boost |
| EVA | Triangle | Enter ship when near the airlock |

## Browser limits

- Gamepads are exposed only after the browser receives input from the device, so
  the user may need to press a controller button once after page load.
- Rumble uses `Gamepad.vibrationActuator.playEffect('dual-rumble')` where
  available, with a legacy `hapticActuators[0].pulse()` fallback. Unsupported
  browsers/controllers safely do nothing.
- Adaptive trigger force feedback and touchpad-specific behavior are deferred.
  Browser Gamepad support does not expose these DualSense features consistently;
  future work can explore WebHID or a native wrapper if those effects become
  important to the VR cockpit feel.

## Debug hooks

`window.__deepSpaceDebug` exposes:

- `getGamepadState()`
- `setGamepadEnabled(boolean)`
- `setGamepadDeadzone(number)` to set both sticks
- `setGamepadLeftDeadzone(number)` for movement / pilot pitch-roll, default `0.22`
- `setGamepadRightDeadzone(number)` for camera look, default `0.16`
