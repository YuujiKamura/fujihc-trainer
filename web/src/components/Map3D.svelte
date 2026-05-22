<script>
  import { onMount, onDestroy } from 'svelte';
  import { loadCourseData } from '../../lib/course_loader.js';
  import { createMapRenderer } from '../../lib/map3d/index.js';
  import { fujihill } from '../../courses/fujihill.js';
  import { rideStore } from '../stores/rideStore.svelte.js';
  import { bleStore } from '../stores/bleStore.svelte.js';
  import { createRideState } from '../../lib/ride_state.js';
  import { integratePhysics } from '../../lib/bike_physics.js';
  import RiderHud from './RiderHud.svelte';

  let mapContainer;
  let statusText = $state('Loading Svelte Map3D...');
  let mapRenderer;
  let animationFrameId;
  let rider;
  let physicsSpeedMps = 0;
  let riderHudPos = $state({ x: -1000, y: -1000 });
  let mapMounted = $state(false);

  // Physics params
  const bikeMass = 65.0 + 8.5;
  const bikeCrr = 0.004;
  const bikeCda = 0.35;
  const inertiaKg = bikeMass;

  onMount(async () => {
    try {
      statusText = 'Fetching course data...';
      const url = 'course.json';
      
      const loaded = await loadCourseData(url);
      const course = loaded.course;
      const terrain = loaded.terrain;
      
      statusText = 'Booting Map3D Engine...';
      
      mapRenderer = createMapRenderer();
      const dbBounds = fujihill.dbBounds; 
      const env = { tileBaseUrl: '/tiles' }; 
      
      mapRenderer.boot(env, {
        container: mapContainer,
        dbBounds,
        onProgress: (done, total) => {
          statusText = `Booting Map3D: ${done}/${total}`;
        },
        onLoaded: async () => {
          statusText = 'Map3D Booted! Setting course...';
          
          await mapRenderer.renderCourse(course);
          mapRenderer.updateRider({ course, curIdx: 0, lat: course[0].lat, lon: course[0].lon });
          mapRenderer.setCameraDefaults({ zoom: 16, pitch: 60 });
          mapRenderer.updateCamera({ 
            course, curIdx: 0, fracInSegment: 0, 
            lon: course[0].lon, lat: course[0].lat, 
            apply: true 
          });

          // Initialize Physics & State
          const rideState = createRideState(course);
          rider = rideState._rider;
          
          rideStore.totalDistMeters = terrain.totalDistance;
          
          // Connect BLE / Test Mode
          bleStore.init();

          statusText = '';
          mapMounted = true;
          
          let lastTime = performance.now();
          
          function tick(now) {
            const dtRaw = (now - lastTime) / 1000;
            lastTime = now;
            
            if (dtRaw > 0 && dtRaw < 2.0 && bleStore.ready) {
              const dt = Math.min(dtRaw, 0.5); // clamp
              
              // Physics integration
              const riderPos = rider.snapshot().position;
              const slopePct = (riderPos && Number.isFinite(riderPos.slope_pct)) ? riderPos.slope_pct : 0;
              
              physicsSpeedMps = integratePhysics(
                physicsSpeedMps, dt, rideStore.power, slopePct,
                { mass: bikeMass, c_rr: bikeCrr, c_d: bikeCda, area: 1, inertia: inertiaKg }
              );
              
              if (Number.isFinite(physicsSpeedMps) && physicsSpeedMps >= 0) {
                rider.setSpeed(physicsSpeedMps);
                rideStore.speedKmh = physicsSpeedMps * 3.6;
              }
              
              rider.tick(dt);
              mapRenderer.render();
              
              rideStore.elapsedSeconds += dt;
              
              const snap = rider.snapshot();
              if (snap.position) {
                const pos = snap.position;
                rideStore.distMeters = pos.distance;
                rideStore.elevationMeters = pos.elevation;
                rideStore.slopePct = slopePct;
                
                // ETA calculation
                if (physicsSpeedMps > 0.5) {
                  rideStore.etaSeconds = (terrain.totalDistance - pos.distance) / physicsSpeedMps;
                } else {
                  rideStore.etaSeconds = null;
                }
                
                mapRenderer.updateRider({ course, curIdx: pos.segmentIdx, lat: pos.lat, lon: pos.lon });
                mapRenderer.updateCamera({ 
                  course, curIdx: pos.segmentIdx, fracInSegment: pos.fracInSegment, 
                  lon: pos.lon, lat: pos.lat, apply: true 
                });
                
                // Update RiderHUD position
                const proj = mapRenderer.project(pos.lon, pos.lat, pos.elevation);
                if (proj) {
                  riderHudPos = { x: proj.x, y: proj.y };
                }
              }
            }
            animationFrameId = requestAnimationFrame(tick);
          }
          
          lastTime = performance.now();
          animationFrameId = requestAnimationFrame(tick);
        }
      });
      
    } catch (e) {
      statusText = `Error: ${e.message}`;
      console.error(e);
    }
  });
  
  onDestroy(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  });
</script>

{#if statusText}
  <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 8px; z-index: 9999; font-family: sans-serif;">
    {statusText}
  </div>
{/if}

<div bind:this={mapContainer} style="position: absolute; inset: 0; background: #87CEEB; overflow: hidden;"></div>

{#if mapMounted}
  <RiderHud x={riderHudPos.x} y={riderHudPos.y} />
{/if}
