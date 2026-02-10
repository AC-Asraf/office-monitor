"""
Office Monitor 3D Floorplan Generator for Blender

Creates a navigable 3D model of your office floors.

INSTRUCTIONS:
1. Open Blender (tested with Blender 3.0+)
2. Go to Scripting workspace
3. Open this file and click "Run Script"
4. Navigate using: Middle Mouse = Orbit, Shift+Middle = Pan, Scroll = Zoom
5. Export: File > Export > glTF 2.0 (.glb/.gltf)

CONFIGURATION OPTIONS BELOW - Change these before running!
"""

import bpy
import bmesh
import math
import json
from mathutils import Vector

# =============================================================================
# CONFIGURATION - CHANGE THESE!
# =============================================================================

# Which floor to generate? Options:
#   "ALL"          - All floors spread horizontally (for overview)
#   "1st Floor"    - Just 1st floor (for navigation)
#   "2nd Floor"    - Just 2nd floor
#   "3rd Floor"    - Just 3rd floor
#   "5th Floor"    - Just 5th floor
FLOOR_TO_GENERATE = "ALL"  # <-- CHANGE THIS

# Layout options
LAYOUT_MODE = "HORIZONTAL"  # "HORIZONTAL" = floors side by side, "STACKED" = floors on top
FLOOR_SPACING = 15.0  # Space between floors when horizontal (meters)

# Dimensions (in meters)
WALL_HEIGHT = 2.8
WALL_THICKNESS = 0.12
DOOR_HEIGHT = 2.1
FLOOR_SIZE = 12.0  # Size of the floor plane

# Visual options
ADD_CEILING = False  # Set True to add ceilings (makes interior darker)
ADD_ROOM_LABELS = True  # Add floating text labels for room names
WALL_OPACITY = 1.0  # 1.0 = solid, 0.5 = semi-transparent

# Scale (increase for larger model)
SCALE = 1.0

# =============================================================================
# ZONE DATA FILE PATH
# =============================================================================

# The script will look for zone data in these locations:
DATA_PATHS = [
    "/tmp/floor_zones.json",
    "/Users/achen-asraf/Desktop/Claude Project/office-monitor/floor_zones.json",
]

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def clear_scene():
    """Remove all objects from the scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)
    for block in bpy.data.collections:
        if block.users == 0:
            bpy.data.collections.remove(block)

def create_collection(name):
    """Create a new collection"""
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))

def create_materials():
    """Create materials for different elements"""
    materials = {}

    # Floor material - light wood
    mat = bpy.data.materials.new(name="Floor")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.76, 0.70, 0.60, 1)
    bsdf.inputs["Roughness"].default_value = 0.6
    materials['floor'] = mat

    # Wall material - off-white
    mat = bpy.data.materials.new(name="Wall")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.92, 0.91, 0.88, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    if WALL_OPACITY < 1.0:
        mat.blend_method = 'BLEND'
        bsdf.inputs["Alpha"].default_value = WALL_OPACITY
    materials['wall'] = mat

    # Outer wall material - slightly darker
    mat = bpy.data.materials.new(name="OuterWall")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.85, 0.83, 0.78, 1)
    bsdf.inputs["Roughness"].default_value = 0.7
    materials['outer_wall'] = mat

    # Door frame material - wood
    mat = bpy.data.materials.new(name="DoorFrame")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.35, 0.22, 0.12, 1)
    bsdf.inputs["Roughness"].default_value = 0.4
    materials['door_frame'] = mat

    # Ceiling material
    mat = bpy.data.materials.new(name="Ceiling")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    materials['ceiling'] = mat

    # Create colored materials for rooms
    room_colors = [
        ('RoomBlue', (0.23, 0.51, 0.96, 1)),
        ('RoomGreen', (0.06, 0.73, 0.51, 1)),
        ('RoomOrange', (0.96, 0.62, 0.04, 1)),
        ('RoomRed', (0.94, 0.27, 0.27, 1)),
        ('RoomPurple', (0.55, 0.36, 0.96, 1)),
    ]
    for name, color in room_colors:
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 0.7
        materials[name.lower()] = mat

    return materials

def parse_points(points_data):
    """Parse points from zone data"""
    if isinstance(points_data, str):
        points_data = json.loads(points_data)
        if isinstance(points_data, str):
            points_data = json.loads(points_data)
    return points_data

def convert_point(p, offset_x=0, offset_y=0):
    """Convert zone point (0-100) to Blender coordinates"""
    x = (p['x'] / 100.0 - 0.5) * FLOOR_SIZE * SCALE + offset_x
    y = -(p['y'] / 100.0 - 0.5) * FLOOR_SIZE * SCALE + offset_y
    return Vector((x, y, 0))

# =============================================================================
# GEOMETRY CREATION
# =============================================================================

def create_floor_plane(name, offset_x, offset_y, collection, materials):
    """Create floor plane"""
    mesh = bpy.data.meshes.new(f"{name}_Floor")
    obj = bpy.data.objects.new(f"{name}_Floor", mesh)
    collection.objects.link(obj)

    bm = bmesh.new()
    size = FLOOR_SIZE * SCALE / 2 * 1.1  # Slightly larger than walls
    verts = [
        bm.verts.new((offset_x - size, offset_y - size, 0)),
        bm.verts.new((offset_x + size, offset_y - size, 0)),
        bm.verts.new((offset_x + size, offset_y + size, 0)),
        bm.verts.new((offset_x - size, offset_y + size, 0)),
    ]
    bm.faces.new(verts)
    bm.to_mesh(mesh)
    bm.free()

    obj.data.materials.append(materials['floor'])
    return obj

def create_wall_segment(p1, p2, height, thickness, name, collection, material):
    """Create a single wall segment"""
    direction = p2 - p1
    length = direction.length
    if length < 0.01:
        return None

    angle = math.atan2(direction.y, direction.x)
    center = (p1 + p2) / 2

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)

    bm = bmesh.new()
    hl = length / 2
    ht = thickness / 2

    # Create wall box
    verts_bottom = [
        bm.verts.new((-hl, -ht, 0)),
        bm.verts.new((hl, -ht, 0)),
        bm.verts.new((hl, ht, 0)),
        bm.verts.new((-hl, ht, 0)),
    ]
    verts_top = [
        bm.verts.new((-hl, -ht, height)),
        bm.verts.new((hl, -ht, height)),
        bm.verts.new((hl, ht, height)),
        bm.verts.new((-hl, ht, height)),
    ]

    # Create faces
    bm.faces.new(verts_bottom)
    bm.faces.new(verts_top[::-1])
    for i in range(4):
        bm.faces.new([verts_bottom[i], verts_bottom[(i+1)%4],
                      verts_top[(i+1)%4], verts_top[i]])

    bm.to_mesh(mesh)
    bm.free()

    obj.location = (center.x, center.y, 0)
    obj.rotation_euler = (0, 0, angle)
    obj.data.materials.append(material)

    return obj

def create_room_walls(zone, offset_x, offset_y, collection, materials):
    """Create walls for a room (closed polygon)"""
    try:
        points = parse_points(zone['points'])
    except:
        return []

    if len(points) < 3:
        return []

    walls = []
    zone_name = zone.get('name', 'Room')
    converted = [convert_point(p, offset_x, offset_y) for p in points]

    for i in range(len(converted)):
        p1 = converted[i]
        p2 = converted[(i + 1) % len(converted)]
        wall = create_wall_segment(
            p1, p2, WALL_HEIGHT * SCALE, WALL_THICKNESS * SCALE,
            f"{zone_name}_Wall_{i}", collection, materials['wall']
        )
        if wall:
            walls.append(wall)

    return walls

def create_open_wall(zone, offset_x, offset_y, collection, materials):
    """Create walls for an open path"""
    try:
        points = parse_points(zone['points'])
    except:
        return []

    if len(points) < 2:
        return []

    walls = []
    zone_name = zone.get('name', 'Wall')
    converted = [convert_point(p, offset_x, offset_y) for p in points]

    for i in range(len(converted) - 1):
        p1 = converted[i]
        p2 = converted[i + 1]
        wall = create_wall_segment(
            p1, p2, WALL_HEIGHT * SCALE, WALL_THICKNESS * SCALE,
            f"{zone_name}_{i}", collection, materials['outer_wall']
        )
        if wall:
            walls.append(wall)

    return walls

def create_door(zone, offset_x, offset_y, collection, materials):
    """Create door opening"""
    try:
        points = parse_points(zone['points'])
    except:
        return []

    if len(points) < 2:
        return []

    zone_name = zone.get('name', 'Door')
    objects = []

    p1 = convert_point(points[0], offset_x, offset_y)
    p2 = convert_point(points[1], offset_x, offset_y)

    direction = p2 - p1
    length = direction.length
    angle = math.atan2(direction.y, direction.x)
    center = (p1 + p2) / 2

    # Header above door
    header_height = (WALL_HEIGHT - DOOR_HEIGHT) * SCALE
    if header_height > 0.05:
        mesh = bpy.data.meshes.new(f"{zone_name}_Header")
        obj = bpy.data.objects.new(f"{zone_name}_Header", mesh)
        collection.objects.link(obj)

        bm = bmesh.new()
        hl = length / 2
        ht = WALL_THICKNESS * SCALE / 2

        v1 = bm.verts.new((-hl, -ht, DOOR_HEIGHT * SCALE))
        v2 = bm.verts.new((hl, -ht, DOOR_HEIGHT * SCALE))
        v3 = bm.verts.new((hl, ht, DOOR_HEIGHT * SCALE))
        v4 = bm.verts.new((-hl, ht, DOOR_HEIGHT * SCALE))
        v5 = bm.verts.new((-hl, -ht, WALL_HEIGHT * SCALE))
        v6 = bm.verts.new((hl, -ht, WALL_HEIGHT * SCALE))
        v7 = bm.verts.new((hl, ht, WALL_HEIGHT * SCALE))
        v8 = bm.verts.new((-hl, ht, WALL_HEIGHT * SCALE))

        bm.faces.new([v1, v2, v3, v4])
        bm.faces.new([v5, v8, v7, v6])
        bm.faces.new([v1, v5, v6, v2])
        bm.faces.new([v3, v7, v8, v4])
        bm.faces.new([v1, v4, v8, v5])
        bm.faces.new([v2, v6, v7, v3])

        bm.to_mesh(mesh)
        bm.free()

        obj.location = (center.x, center.y, 0)
        obj.rotation_euler = (0, 0, angle)
        obj.data.materials.append(materials['wall'])
        objects.append(obj)

    # Door posts
    post_size = 0.06 * SCALE
    for i, pos in enumerate([p1, p2]):
        mesh = bpy.data.meshes.new(f"{zone_name}_Post_{i}")
        obj = bpy.data.objects.new(f"{zone_name}_Post_{i}", mesh)
        collection.objects.link(obj)

        bm = bmesh.new()
        hs = post_size / 2
        for z in [0, DOOR_HEIGHT * SCALE]:
            bm.verts.new((-hs, -hs, z))
            bm.verts.new((hs, -hs, z))
            bm.verts.new((hs, hs, z))
            bm.verts.new((-hs, hs, z))

        bm.verts.ensure_lookup_table()
        bm.faces.new([bm.verts[0], bm.verts[1], bm.verts[2], bm.verts[3]])
        bm.faces.new([bm.verts[4], bm.verts[7], bm.verts[6], bm.verts[5]])
        for j in range(4):
            bm.faces.new([bm.verts[j], bm.verts[(j+1)%4],
                          bm.verts[(j+1)%4+4], bm.verts[j+4]])

        bm.to_mesh(mesh)
        bm.free()

        obj.location = (pos.x, pos.y, 0)
        obj.data.materials.append(materials['door_frame'])
        objects.append(obj)

    return objects

def create_text_label(text, location, collection):
    """Create a floating text label"""
    try:
        curve = bpy.data.curves.new(type="FONT", name=text)
        curve.body = text
        curve.size = 0.3 * SCALE
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'

        obj = bpy.data.objects.new(name=text, object_data=curve)
        collection.objects.link(obj)

        obj.location = (location.x, location.y, WALL_HEIGHT * SCALE + 0.1)
        obj.rotation_euler = (math.radians(90), 0, 0)

        return obj
    except:
        return None

def setup_lighting():
    """Set up lighting"""
    # Sun
    light = bpy.data.lights.new(name="Sun", type='SUN')
    light.energy = 4
    light.color = (1, 0.97, 0.92)
    obj = bpy.data.objects.new(name="Sun", object_data=light)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(50), math.radians(20), math.radians(30))

    # Fill light
    light2 = bpy.data.lights.new(name="Fill", type='SUN')
    light2.energy = 1.5
    light2.color = (0.9, 0.95, 1.0)
    obj2 = bpy.data.objects.new(name="Fill", object_data=light2)
    bpy.context.scene.collection.objects.link(obj2)
    obj2.rotation_euler = (math.radians(70), math.radians(-30), math.radians(-45))

    # World background
    bpy.context.scene.world.use_nodes = True
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.7, 0.8, 0.9, 1)  # Light blue sky
    bg.inputs[1].default_value = 1.0

def setup_camera(center_x, center_y):
    """Set up camera"""
    cam = bpy.data.cameras.new(name="Camera")
    cam.lens = 35
    obj = bpy.data.objects.new(name="Camera", object_data=cam)
    bpy.context.scene.collection.objects.link(obj)

    # Position for nice overview
    obj.location = (center_x + 12, center_y - 12, 15)
    obj.rotation_euler = (math.radians(60), 0, math.radians(45))

    bpy.context.scene.camera = obj

# =============================================================================
# MAIN
# =============================================================================

def main():
    print("\n" + "=" * 60)
    print("Office Monitor 3D Floorplan Generator")
    print("=" * 60)

    # Load zone data
    zone_data = None
    import os

    for path in DATA_PATHS:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    zone_data = json.load(f)
                print(f"Loaded: {path}")
                break
            except Exception as e:
                print(f"Failed: {path} - {e}")

    if not zone_data:
        print("\nERROR: No zone data found!")
        print("Run this command first:")
        print('  curl -s "http://localhost:3002/api/floor-zones" > /tmp/floor_zones.json')
        return

    zones = zone_data.get('zones', [])
    print(f"Found {len(zones)} zones")

    # Group by floor
    floors = {}
    for zone in zones:
        floor = zone.get('floor', 'Unknown')
        if floor not in floors:
            floors[floor] = {'rooms': [], 'walls': [], 'doors': []}

        zone_type = zone.get('type', 'room')
        if zone_type == 'door':
            floors[floor]['doors'].append(zone)
        elif zone_type == 'wall':
            floors[floor]['walls'].append(zone)
        else:
            floors[floor]['rooms'].append(zone)

    # Filter floors if needed
    if FLOOR_TO_GENERATE != "ALL":
        if FLOOR_TO_GENERATE in floors:
            floors = {FLOOR_TO_GENERATE: floors[FLOOR_TO_GENERATE]}
        else:
            print(f"Floor '{FLOOR_TO_GENERATE}' not found!")
            print(f"Available: {list(floors.keys())}")
            return

    print(f"Generating: {list(floors.keys())}")

    # Clear scene
    clear_scene()

    # Create materials
    materials = create_materials()

    # Calculate floor positions
    floor_list = list(floors.keys())
    floor_positions = {}

    if LAYOUT_MODE == "HORIZONTAL":
        for i, floor_name in enumerate(floor_list):
            col = i % 2
            row = i // 2
            floor_positions[floor_name] = (
                col * FLOOR_SPACING,
                -row * FLOOR_SPACING
            )
    else:  # STACKED
        for i, floor_name in enumerate(floor_list):
            floor_positions[floor_name] = (0, 0)

    # Generate each floor
    for floor_name, floor_data in floors.items():
        print(f"\nGenerating {floor_name}...")

        offset_x, offset_y = floor_positions[floor_name]
        collection = create_collection(floor_name)

        # Floor plane
        create_floor_plane(floor_name, offset_x, offset_y, collection, materials)

        # Room walls
        for zone in floor_data['rooms']:
            create_room_walls(zone, offset_x, offset_y, collection, materials)

            # Room label
            if ADD_ROOM_LABELS:
                try:
                    points = parse_points(zone['points'])
                    if points:
                        cx = sum(p['x'] for p in points) / len(points)
                        cy = sum(p['y'] for p in points) / len(points)
                        center = convert_point({'x': cx, 'y': cy}, offset_x, offset_y)
                        create_text_label(zone.get('name', ''), center, collection)
                except:
                    pass

        # Open walls
        for zone in floor_data['walls']:
            create_open_wall(zone, offset_x, offset_y, collection, materials)

        # Doors
        for zone in floor_data['doors']:
            create_door(zone, offset_x, offset_y, collection, materials)

        print(f"  {len(floor_data['rooms'])} rooms, {len(floor_data['walls'])} walls, {len(floor_data['doors'])} doors")

    # Setup scene
    setup_lighting()

    center_x = sum(p[0] for p in floor_positions.values()) / len(floor_positions)
    center_y = sum(p[1] for p in floor_positions.values()) / len(floor_positions)
    setup_camera(center_x, center_y)

    # Render settings
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 64
    bpy.context.scene.cycles.use_denoising = True

    print("\n" + "=" * 60)
    print("DONE!")
    print("=" * 60)
    print("\nNavigation:")
    print("  Middle Mouse = Orbit")
    print("  Shift + Middle Mouse = Pan")
    print("  Scroll = Zoom")
    print("  Numpad 0 = Camera view")
    print("\nExport:")
    print("  File > Export > glTF 2.0 (.glb)")
    print("\nTip: Change FLOOR_TO_GENERATE to view one floor at a time")

if __name__ == "__main__":
    main()
