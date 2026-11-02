"""Adopted-route contracts: real surface coverage and continuous body clearance."""
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from complete_route import (
    BODY_RADIUS, polygon_distance, partition_surface_segment, ring3,
    segment_distance, segment_edge_parameters, speed_time,
)
from import_plateau import load_terrain


class ContinuousGeometry(unittest.TestCase):
    def test_midsegment_obstacle_is_detected_when_endpoints_are_clear(self):
        obstacle = [[4.9, -.1], [5.1, -.1], [5.1, .1], [4.9, .1]]
        self.assertEqual(polygon_distance([0, 0], [10, 0], obstacle), 0)
        self.assertAlmostEqual(polygon_distance([0, .3], [10, .3], obstacle), .2)
        self.assertLess(polygon_distance([0, .3], [10, .3], obstacle), BODY_RADIUS)

    def test_surface_interval_check_catches_a_gap_smaller_than_sampling(self):
        surfaces = [
            {"id": "left", "category": "paving", "boundary_m": ring3([[0, -1], [4.999, -1], [4.999, 1], [0, 1]])},
            {"id": "right", "category": "paving", "boundary_m": ring3([[5.001, -1], [10, -1], [10, 1], [5.001, 1]])},
        ]
        spans = partition_surface_segment([0, 0], [10, 0], surfaces)
        uncovered = sum((hi - lo) * 10 for lo, hi, category, _ in spans if category == "unclassified")
        self.assertAlmostEqual(uncovered, .002, places=8)

    def test_parallel_segments_do_not_create_false_intersections(self):
        self.assertEqual(segment_edge_parameters([0, 0], [10, 0], [2, 1], [8, 1]), [])
        self.assertEqual(segment_edge_parameters([0, 0], [10, 0], [2, 0], [8, 0]), [.2, .8])
        self.assertAlmostEqual(segment_distance([0, 0], [10, 0], [2, 1], [8, 1]), 1)

    def test_speed_profile_starts_and_ends_at_rest_without_time_reversal(self):
        times = [speed_time(s / 10, 20) for s in range(201)]
        self.assertEqual(times[0], 0)
        self.assertAlmostEqual(times[-1], 23)
        self.assertTrue(all(b > a for a, b in zip(times, times[1:])))
        self.assertGreater(times[1] - times[0], times[101] - times[100])
        self.assertGreater(times[-1] - times[-2], times[101] - times[100])


class PublishedAdoptedRoute(unittest.TestCase):
    def setUp(self):
        self.report = json.loads((ROOT / "data/derived/kabukicho-route-completion.json").read_text())
        self.walk = json.loads((ROOT / "scenes/shinjuku/kabukicho/1976/cameras/adopted-walk.json").read_text())

    def test_original_gap_is_explicitly_inferred_and_every_adopted_interval_is_covered(self):
        decision = json.loads((ROOT / "data/decisions/kabukicho-route-surfaces-1976.json").read_text())
        self.assertEqual(len(decision["original_unclassified_samples"]), 4)
        self.assertEqual(decision["historical_confidence"], "inferred")
        self.assertTrue(decision["decision_complete"])
        self.assertEqual(self.report["adopted"]["unclassified_samples"], 0)
        self.assertEqual(self.report["adopted"]["continuous_unclassified_length_m"], 0)
        self.assertEqual(self.report["adopted"]["continuous_surface_gaps"], [])
        self.assertNotIn("unclassified", {sample["surface_category"] for sample in self.walk["samples"]})

    def test_all_modeled_props_and_buildings_have_continuous_body_clearance(self):
        validation = self.report["collision_validation"]
        self.assertEqual(self.report["status"], "complete")
        self.assertTrue(validation["period_obstacles_complete"])
        self.assertTrue(validation["continuous"])
        self.assertEqual(validation["body_radius_m"], .35)
        self.assertGreater(validation["prop_obstacles_checked"], 0)
        self.assertEqual(validation["collisions"], [])
        self.assertGreater(validation["minimum_net_clearance_m"], 0)
        for passage in validation["overhead_passages"]:
            self.assertGreaterEqual(passage["underside_clearance_m"], 2.2)

    def test_walk_sees_the_gate_and_reaches_the_adopted_theatre_entrance(self):
        route = json.loads((ROOT / "scenes/shinjuku/kabukicho/1976/cameras/route-proposal.json").read_text())
        arrival = self.walk["terminal_station"]
        self.assertEqual(arrival["id"], "theatre-arrival")
        self.assertEqual(self.walk["route_control_points_m"][:6], route["geometry"]["coordinates"])
        self.assertEqual(len(self.walk["route_control_points_m"]), 7)
        self.assertEqual(arrival["entrance_fraction"], .48)
        self.assertAlmostEqual(math.dist(arrival["entrance_edge_position_xz_m"],
                                        [arrival["ground_position_m"][0], arrival["ground_position_m"][2]]), 9)
        self.assertGreaterEqual(arrival["minimum_net_static_clearance_m"], .5)
        self.assertEqual(arrival["nearest_terminal_obstacle_id"], "koma-south-entry-steps")
        self.assertLess(math.dist(self.walk["samples"][-1]["ground_position_m"], arrival["ground_position_m"]), 1e-6)
        self.assertLess(math.dist(self.walk["samples"][-1]["look_at_m"], arrival["look_at_m"]), 1e-6)
        self.assertGreater(self.walk["samples"][0]["pitch_deg"], 20)
        self.assertLess(self.walk["samples"][0]["pitch_deg"], 30)
        for sample in self.walk["samples"]:
            if 16 <= sample["cumulative_ground_distance_m"] <= 20:
                self.assertEqual(sample["pitch_deg"], 0)

    def test_motion_samples_follow_terrain_and_use_monotonic_time_and_shortest_rotations(self):
        terrain = load_terrain()
        samples = self.walk["samples"]
        self.assertEqual(self.walk["focal_length_35mm_equivalent_mm"], 35)
        self.assertFalse(self.walk["route_diagnostic_cameras_modified"])
        for sample in samples:
            p, ground = sample["position_m"], sample["ground_position_m"]
            self.assertAlmostEqual(p[1] - terrain.height(p[0], p[2]), 1.6, places=5)
            self.assertAlmostEqual(p[1] - ground[1], 1.6, places=6)
            self.assertAlmostEqual(sum(v * v for v in sample["quaternion_xyzw"]), 1, places=6)
        for a, b in zip(samples, samples[1:]):
            self.assertGreater(b["time_s"], a["time_s"])
            self.assertLessEqual(math.dist(a["ground_position_m"], b["ground_position_m"]), .250001)
            dot = sum(x * y for x, y in zip(a["quaternion_xyzw"], b["quaternion_xyzw"]))
            self.assertGreaterEqual(dot, 0, "Quaternion signs must remain continuous")
            angular_rate = math.degrees(2 * math.acos(min(1., max(-1., dot)))) / (b["time_s"] - a["time_s"])
            self.assertLessEqual(angular_rate, 35.05)
        self.assertAlmostEqual(samples[-1]["time_s"], self.walk["duration_s"], places=6)


if __name__ == "__main__":
    unittest.main()
