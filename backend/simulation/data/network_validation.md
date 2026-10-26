# Transport Network Validation

- Network: `/Users/gahn/projects/scnu-wt/routing/backend/simulation/data/campus_transport_network.geojson`
- Result: **PASS**
- Nodes / Edges / POIs: 528 / 724 / 14
- Derived / Non-derived / Authoritative edges: 191 / 533 / 521

## Edge kinds

- `allowed_road`: 375
- `building_entrance`: 6
- `crosswalk`: 28
- `parking_connection`: 2
- `parking_walk`: 4
- `pedestrian_gate`: 4
- `scooter_parking_connection`: 2
- `shared_path`: 154
- `sidewalk`: 145
- `vehicle_gate`: 4

## Connectivity

- car: 381 edges, 1 components, largest coverage 100.0%
- person: 341 edges, 1 components, largest coverage 100.0%
- scooter: 573 edges, 48 components, largest coverage 75.53%

## Errors

- None

## Warnings

- `CROSSING_NARROWER_THAN_4M` — `EDGE_CW_004` 
- `CROSSING_NARROWER_THAN_4M` — `EDGE_CW_007` 
- `CROSSING_NARROWER_THAN_4M` — `EDGE_CW_020` 
- `CROSSING_NARROWER_THAN_4M` — `EDGE_CW_022` 
- `SIDEWALK_NARROWER_THAN_1_5M` — `EDGE_SW_0092` 
- `SIDEWALK_NARROWER_THAN_1_5M` — `EDGE_SW_0093` 
- `SIDEWALK_NARROWER_THAN_1_5M` — `EDGE_SW_0098` 
- `NETWORK_NOT_FULLY_CONNECTED` — `scooter` 
