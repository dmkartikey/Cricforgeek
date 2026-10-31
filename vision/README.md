# Nets analyser lab

Training and testing for cricforgeek's nets video analyser: film a nets session on a phone, get every delivery's speed,
line, length, swing and bounce.

- `nets/deliveries.py`: physics of a cricket delivery (drag, swing, bounce, seam and spin) with exact ground truth
- `nets/camera.py`: a phone camera (lens, position, frame rate, shutter, rolling shutter)
- `nets/render.py`: renders synthetic nets video with the true ball position in every frame
- later: the ball detector, the calibration from the stumps, the physics fit and the accuracy benchmark

Coordinates (metres): x along the pitch from the bowler's middle stump (0) to the batter's middle stump (20.12),
y across the pitch (positive to the bowler's right), z up from the ground.
