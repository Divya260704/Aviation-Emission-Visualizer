import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import 'leaflet.heat';

const createPlaneIcon = (heading, theme, isSelected) => {
  const color = isSelected ? '#facc15' : (theme === 'dark' ? '#60a5fa' : '#3b82f6');
  const strokeColor = theme === 'dark' ? '#1e293b' : '#ffffff';
  const shadow = isSelected
    ? 'drop-shadow(0px 0px 10px rgba(250,204,21,1.0))'
    : (theme === 'dark' ? 'drop-shadow(0px 2px 4px rgba(0,0,0,0.8))' : 'drop-shadow(0px 3px 5px rgba(0,0,0,0.5))');
  const size = isSelected ? 40 : 26;

  return L.divIcon({
    html: `
      <div style="transform: rotate(${heading}deg); color: ${color}; filter: ${shadow}; transform-origin: center; display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <path d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z"
                fill="currentColor"
                stroke="${strokeColor}"
                stroke-width="1.2"
                stroke-linejoin="round" />
        </svg>
      </div>
    `,
    className: 'plane-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)]
  });
};

function EmissionHeatmapLayer() {
  const map = useMap();
  const heatLayerRef = useRef(null);

  useEffect(() => {
    // Generate geographically anchored concentric heat dispersion around Chennai Airport (MAA)
    // The footprint spans a realistic "affecting limit" radius of 5km
    const originLat = 12.9822;
    const originLng = 80.1692;
    const affectingRadiusKm = 5; 
    const heatData = [];
    
    // Core terminal / tarmac intense spot
    heatData.push([originLat, originLng, 1.0]);
    
    // Concentric dispersion rings
    for (let r = 1; r <= affectingRadiusKm; r++) {
      const numPoints = r * 8; // more points logically needed for larger circumference
      const radiusDeg = r * 0.009; // 1km is roughly 0.009 degrees
      const weight = Math.max(0.1, 1.0 - Math.pow(r / affectingRadiusKm, 0.8)); // Decays outward
      
      // Simulate slight SW sea-breeze elongation typical to Chennai
      const windSkewLng = (r / affectingRadiusKm) * 0.02; 
      
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const latOffset = Math.sin(angle) * radiusDeg;
        const lngOffset = Math.cos(angle) * radiusDeg + windSkewLng;
        heatData.push([originLat + latOffset, originLng + lngOffset, weight]);
      }
    }

    if (!heatLayerRef.current) {
      if (L.heatLayer) {
        heatLayerRef.current = L.heatLayer(heatData, {
          radius: 30,
          blur: 25,
          maxZoom: 14,
          max: 1.0, 
          gradient: { 0.1: 'blue', 0.3: 'cyan', 0.5: 'lime', 0.7: 'yellow', 0.9: 'red', 1.0: '#881337' }
        }).addTo(map);
      }
    } else {
      heatLayerRef.current.setLatLngs(heatData);
    }
  }, [map]);

  return null;
}

// Inner controller — reacts to flyKey changes so same-flight re-clicks also trigger flyTo
function MapFlyController({ selectedFlight, flyKey, markerRefs }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedFlight) return;
    const { lat, lng, id } = selectedFlight;
    // Only fly if we have a real position (not the MAA fallback lat for on-ground/scheduled flights)
    if (lat == null || lng == null) return;

    // Use zoom=12 for in-flight planes, zoom=13 for on-ground/MAA-tagged ones
    const zoom = (lat === 13.0827 && lng === 80.1692) ? 13 : 11;
    map.flyTo([lat, lng], zoom, { duration: 1.4, easeLinearity: 0.25 });

    // Open popup after animation
    setTimeout(() => {
      const ref = markerRefs.current[id];
      if (ref) ref.openPopup();
    }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]); // depend on flyKey so same flight re-click still triggers

  return null;
}

function FlightMap({ theme, flights = [], selectedFlight, flyKey, onSelectFlight }) {
  const markerRefs = useRef({});
  const chennaiFlights = flights.filter(f => f.is_chennai);

  return (
    <div style={{
      flex: 1, minWidth: 320, padding: 16, borderRadius: 12,
      border: '1px solid ' + (theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
      background: theme === 'dark' ? '#0f172a' : '#ffffff'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ color: theme === 'dark' ? 'white' : 'black', fontWeight: 800, fontSize: 16 }}>
          🛫 Live Aviation Map
          <span style={{ fontSize: 13, marginLeft: 12, fontWeight: 500, opacity: 0.7 }}>
            {flights.length} total · {chennaiFlights.length} MAA
          </span>
        </div>
        {selectedFlight && (
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: '#facc15', background: 'rgba(250,204,21,0.12)',
            padding: '4px 12px', borderRadius: 99, border: '1px solid rgba(250,204,21,0.3)',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            📍 Tracking: {selectedFlight.callsign}
            <span
              style={{ cursor: 'pointer', opacity: 0.7, fontWeight: 900, marginLeft: 4 }}
              onClick={() => onSelectFlight && onSelectFlight(null)}
              title="Clear selection"
            >✕</span>
          </span>
        )}
      </div>

      <div style={{ height: 520, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
        <MapContainer
          key="chennai-regional-map"
          center={[12.9822, 80.1692]}
          zoom={8}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className={theme === 'dark' ? 'dark-map-tiles' : ''}
          />

          <MapFlyController selectedFlight={selectedFlight} flyKey={flyKey} markerRefs={markerRefs} />

          {/* Chennai Airport marker */}
          <CircleMarker
            center={[12.9822, 80.1692]}
            pathOptions={{
              color: theme === 'dark' ? '#fbbf24' : '#d97706',
              fillColor: theme === 'dark' ? '#fbbf24' : '#d97706',
              fillOpacity: 0.6,
              weight: 2
            }}
            radius={10}
          >
            <Tooltip permanent direction="right" offset={[12, 0]} opacity={1}>
              <span style={{ fontWeight: 800, color: 'black', fontSize: 12 }}>
                ✈ Chennai (MAA / VOMM)
              </span>
            </Tooltip>
          </CircleMarker>

          <EmissionHeatmapLayer flights={flights} />

          {flights && flights.map((flight) => {
            const isSelected = selectedFlight?.id === flight.id;
            if (flight.lat == null || flight.lng == null) return null;
            return (
              <Marker
                key={flight.id}
                position={[flight.lat, flight.lng]}
                icon={createPlaneIcon(flight.heading, theme, isSelected)}
                ref={(ref) => { if (ref) markerRefs.current[flight.id] = ref; }}
                eventHandlers={{
                  click: () => onSelectFlight && onSelectFlight(flight),
                }}
              >
                <Popup minWidth={220}>
                  <div style={{ textAlign: 'left', fontWeight: 'bold', color: 'black' }}>
                    <div style={{ fontWeight: 900, fontSize: 15, borderBottom: '1px solid #ddd', paddingBottom: 5, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>✈️ {flight.callsign || 'Unknown'}</span>
                      {flight.is_chennai && <span style={{ fontSize: 10, color: '#d97706', fontWeight: 700, background: 'rgba(217,119,6,0.12)', padding: '2px 6px', borderRadius: 4 }}>MAA</span>}
                    </div>

                    <div style={{ fontSize: 13, background: 'rgba(0,0,0,0.05)', padding: 6, borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563eb', marginBottom: 3 }}>
                        <span style={{ fontWeight: 800 }}>{flight.origin || 'Unknown'}</span>
                        <span style={{ fontFamily: 'monospace' }}>Dep {flight.dep_time || '-'}</span>
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'center' }}>▼</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a', marginTop: 3 }}>
                        <span style={{ fontWeight: 800 }}>{flight.dest || 'Unknown'}</span>
                        <span style={{ fontFamily: 'monospace' }}>Arr {flight.eta || '-'}</span>
                      </div>
                    </div>

                    <div style={{ fontSize: 13, marginBottom: 3 }}><span style={{ opacity: 0.6 }}>Operator: </span>{flight.airline || '-'}</div>
                    <div style={{ fontSize: 13, marginBottom: 3 }}><span style={{ opacity: 0.6 }}>Aircraft: </span>{!flight.ac_type || flight.ac_type === 'Unknown' ? '-' : flight.ac_type}</div>
                    <div style={{ fontSize: 13, marginBottom: 3 }}><span style={{ opacity: 0.6 }}>Status: </span><b>{flight.status || '-'}</b></div>
                    <div style={{ fontSize: 12, marginBottom: 3 }}><span style={{ opacity: 0.6 }}>Alt / Spd: </span>{Math.round(flight.altitude || 0)} m / {Math.round(flight.velocity || 0)} m/s</div>
                    <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                      📡 {flight.lat?.toFixed(4)}°N, {flight.lng?.toFixed(4)}°E
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <style>{`
          .dark-map-tiles {
            filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
          }
          .plane-icon { background: none !important; border: none !important; }
        `}</style>
      </div>
    </div>
  );
}

export default FlightMap;
