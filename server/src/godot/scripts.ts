/** GDScript sources written into every exported Godot project. */

export const MAIN_GD = `extends Node3D
## Entry point. Uses a VR headset (OpenXR) when one is available, otherwise a first-person desktop player.

@export var teleports: Array[Dictionary] = []

@onready var player: CharacterBody3D = $Player
@onready var xr_rig: XROrigin3D = $XRRig
@onready var overview: Camera3D = $Overview
var hud: Label
var vr_active := false

func _ready() -> void:
	var xr := XRServer.find_interface("OpenXR")
	if xr != null and xr.is_initialized():
		vr_active = true
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		xr_rig.global_transform = player.global_transform
		xr_rig.get_node("XRCamera3D").current = true
		player.queue_free()
	else:
		xr_rig.queue_free()
		_build_hud()
		for arg in OS.get_cmdline_user_args():
			if arg == "--overview":
				_set_overview(true)
			elif arg.begins_with("--tp="):
				_go(int(arg.substr(5)))

func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Label.new()
	hud.position = Vector2(16, 12)
	hud.add_theme_font_size_override("font_size", 16)
	hud.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	hud.add_theme_constant_override("shadow_offset_x", 1)
	hud.add_theme_constant_override("shadow_offset_y", 1)
	hud.text = "Click to look around  |  WASD move  |  Shift run  |  1-9 or Tab jump to a room  |  B bird's-eye view  |  Esc release mouse"
	layer.add_child(hud)

func _unhandled_input(event: InputEvent) -> void:
	if vr_active or teleports.is_empty():
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_B:
			_set_overview(not overview.current)
			return
		var idx := -1
		if event.keycode == KEY_TAB:
			idx = (int(player.get_meta("tp_index", -1)) + 1) % teleports.size()
		elif event.keycode >= KEY_1 and event.keycode <= KEY_9:
			idx = event.keycode - KEY_1
		if idx >= 0 and idx < teleports.size():
			_go(idx)

func _set_overview(on: bool) -> void:
	overview.current = on
	$Ceiling.visible = not on
	if not on:
		player.get_node("Head/Camera3D").current = true

func _go(idx: int) -> void:
	var t: Dictionary = teleports[idx]
	player.global_position = Vector3(t["x"], 0.05, t["z"])
	player.rotation.y = t["yaw"]
	player.velocity = Vector3.ZERO
	player.set_meta("tp_index", idx)
	player.get_node("Head/Camera3D").current = true
	if hud:
		hud.text = "%s  |  WASD move  |  Shift run  |  1-9 or Tab jump to a room  |  B bird's-eye view  |  Esc release mouse" % t["label"]
`;

export const PLAYER_GD = `extends CharacterBody3D
## First-person walker: real eye height and walking speed, gravity, mouse look.

const EYE_HEIGHT := 1.65
const WALK_SPEED := 1.4
const RUN_SPEED := 2.8
const MOUSE_SENS := 0.0022

@onready var head: Node3D = $Head
var pitch := 0.0

func _ready() -> void:
	head.position.y = EYE_HEIGHT

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * MOUSE_SENS)
		pitch = clamp(pitch - event.relative.y * MOUSE_SENS, -1.4, 1.4)
		head.rotation.x = pitch

func _physics_process(delta: float) -> void:
	var dir := Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		dir.z -= 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		dir.z += 1.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		dir.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		dir.x += 1.0
	dir = (global_transform.basis * dir).normalized()
	var speed := RUN_SPEED if Input.is_physical_key_pressed(KEY_SHIFT) else WALK_SPEED
	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	velocity.y = velocity.y - 9.8 * delta if not is_on_floor() else -0.1
	move_and_slide()
`;

export const XR_RIG_GD = `extends XROrigin3D
## Simple VR locomotion: left stick walks in the direction you look, right stick snap-turns.

const WALK_SPEED := 1.6
const SNAP_DEGREES := 30.0
const DEADZONE := 0.25

var snap_ready := true

func _physics_process(delta: float) -> void:
	var left := get_node_or_null("LeftHand") as XRController3D
	var right := get_node_or_null("RightHand") as XRController3D
	var cam := get_node_or_null("XRCamera3D") as XRCamera3D
	if left and cam:
		var stick := left.get_vector2("primary")
		if stick.length() > DEADZONE:
			var forward := -cam.global_transform.basis.z
			forward.y = 0.0
			forward = forward.normalized()
			var side := cam.global_transform.basis.x
			side.y = 0.0
			side = side.normalized()
			global_position += (forward * stick.y + side * stick.x) * WALK_SPEED * delta
	if right:
		var turn := right.get_vector2("primary").x
		if abs(turn) > 0.7 and snap_ready:
			rotate_y(deg_to_rad(-SNAP_DEGREES * sign(turn)))
			snap_ready = false
		elif abs(turn) < 0.3:
			snap_ready = true
`;

export const PROJECT_README = (name: string) => `# ${name}: Godot walkthrough

Generated by SpacePlanner Web from a floor plan and a furnished layout.

## Open it

1. Open **Godot 4.3 or newer**, click **Import**, and choose \`project.godot\` in this folder.
2. Wait for the first import to finish (the 3D models are converted once).
3. Press **F5** to run.

## Desktop controls

| Key | Action |
| --- | --- |
| Click | capture the mouse and look around |
| W A S D / arrows | walk |
| Shift | run |
| 1 - 9, Tab | jump to a room or zone |
| B | bird's-eye overview of the whole floor |
| Esc | release the mouse |

## VR (optional)

The desktop first-person view is the main way to explore this. A VR rig is included but switched off. With a
headset connected through SteamVR or Meta Link, set \`xr/openxr/enabled\` to true in Project Settings, restart
Godot, and it starts in VR (left stick walks, right stick snap-turns).

## What is in here

- \`main.tscn\`: the whole building (floor, walls, windows, partitions, furniture)
- \`assets/models/\`: the furniture models used by this layout
- \`scripts/\`: player, VR rig and start-up logic
`;

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f6b5c"/><path d="M8 9h9v6h7v8H8z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M8 15h5" stroke="#fff" stroke-width="2"/></svg>
`;
