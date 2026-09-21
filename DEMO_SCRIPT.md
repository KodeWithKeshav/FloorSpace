# Five-minute demo

Start with `npm run dev` and open http://localhost:5173.

**1. The plan (30 s).** "Large Open Floor Plate" is selected. Hover a door or core for its details. Show that a bad file is caught: paste JSON with a window moved off the wall and the error names the exact path (`openings[2].wall`) and highlights it on the plan.

**2. The brief that fits (60 s).** Continue. This is the 100-seater: reception, 100 desks, 2 cabins, 3 meeting rooms, cafeteria, phone booths. The right panel already says *Fits comfortably* before anything is generated. Press **Generate layout**.

**3. Occupied vs free (60 s).** The layout screen shows the furnished plan. Point at **Space usage**: occupied vs free, and what the free area is made of (corridors and aisles vs unassigned floor). Hover a zone chip to highlight it. Note the desks and chairs face each other and every room has a door onto a route.

**4. Walk it (90 s).** **Walk through it in 3D.** Click, then WASD. Use **Go to** to jump to the meeting room, the cabin and reception. Try to walk through a desk or wall: you can't. Toggle **Bird's-eye view** and back. The minimap follows you.

**5. In Godot (30 s).** Back on the layout screen, **Open in Godot on this computer**. Press F5 in Godot and walk the same building in first person.

**6. Finish on the refusal (60 s).** Go back to the plan, choose **Compact Studio Floor**, continue. The same 100-seat brief is red: *Does not fit*, with the honest maximum and concrete options. Click **Keep only the essentials** and watch it turn amber/green, then generate the best fit. The system refusing intelligently is the strongest part of the demo.
