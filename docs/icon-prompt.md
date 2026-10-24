# OCP studio — icon prompt

Copy the block below into the image model. It is written for a model that draws
vectors rather than one that paints: every clause is a constraint that the last
few attempts broke.

---

## Main prompt (light gray on black)

```
Flat vector logo, square 1:1 canvas, perfectly centred.

Composition, two lines:
- Top line: the three capital letters "OCP" in a very bold geometric grotesque
  (Futura / ITC Avant Garde Gothic style), one consistent stroke weight, all
  three letters the same cap height on one baseline.
- Bottom line: the lowercase word "studio" in the same geometric grotesque,
  roughly one third of the height of the top line, centred beneath the letters,
  with wide and even letter spacing between every letter.

The letters, precisely:
- The O is a plain perfect circle: a solid ring, no teeth, no notch.
- The P is a plain letter P: a straight vertical stem and a wide half-round
  bowl on its right side, the bowl about two thirds of the cap height tall.
- The C is a cogwheel, not a normal letter. It is a thick ring of exactly the
  same stroke weight as the O and the P, open on the RIGHT-hand side with a
  clean, fully open 65 degree gap where a C's mouth belongs — the black
  background shows straight through that gap. Around the outside of that ring
  sit exactly FIVE rectangular machined teeth. They are evenly spaced about 65
  degrees apart across the ring's left half, they taper very slightly toward
  their tips, each reaches about one quarter of the ring's thickness beyond it,
  and each is about as wide as it is tall. No tooth is inside the ring, no tooth
  crosses the opening, no two teeth touch, and no sixth tooth appears. The shape
  must still read instantly as the letter C — an open mouth on the right, five
  teeth on the outside arc.

Colour: the entire mark in one single light gray, #c9ccd1, on a pure black
#000000 background that fills the square. Flat, two-tone, nothing else.

Rendering: flat vector illustration, razor-sharp edges, constant stroke weight,
mathematically even spacing, generous and even margins on all four sides, the
two lines optically balanced as a unit.

Spelling matters: exactly "OCP" and exactly "studio" — no other letter, word,
number or mark anywhere in the image.
```

## Negative prompt

```
extra letters, misspelled word, third line of text, more than five teeth, fewer
than five teeth, uneven tooth spacing, teeth inside the ring, teeth touching,
teeth across the opening, closed ring, ring without an opening, gear with a
solid centre, spokes, axle, hub, bolt, screw, screw head, a second cog, the O
with teeth, a decorated P, gradients, glow, drop shadow, bevel, emboss, 3D
render, metallic material, perspective, isometric, sketch, hatching, outline
sketch, texture, noise, grain, vignette, frame, border, watermark, signature,
caption, mockup, device, background pattern
```

## If the model still fumbles the cog

Feed the geometry as a checklist instead of prose — models that ignore
adjectives obey counts:

```
Draw five separate rectangles only, arranged in an arc:
teeth centred at 51, 115, 180, 245 and 309 degrees, measured clockwise from the
3 o'clock position of the ring; each tooth 24 degrees wide at its base, 18
degrees at its tip, projecting 0.17 of the ring's outer diameter beyond the ring.
Leave 180 +/- 32 degrees empty: that empty wedge is the letter C's mouth.
```

## Variants

- **Dark tile:** same prompt, background `#1a1a1e`, and the square as a rounded
  rectangle with a corner radius about 23% of the side, mark inset to 87% so it
  does not touch the rounded corners.
- **Light theme:** mark `#1c1c1e` on a `#f4f4f5` background.
- **Accent:** mark `#c96442` on `#0b0b0d`; keep it to one colour, not two.
- **App icon:** add "the mark fills 78% of the square, optically centred, nothing
  else in the frame".

## Reject and regenerate when

1. Count the teeth: exactly five, outside the ring, evenly spaced, none inside.
2. The C's mouth is still open on the right and shows background through it.
3. The O has no teeth and the P has no decoration.
4. "studio" is spelled right and sits centred, roughly a third of the top line.
5. One single foreground colour, flat, on an unbroken background.
6. No extra glyphs, no third line, no mockup furniture.
