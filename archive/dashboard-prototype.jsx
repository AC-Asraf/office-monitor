import React, { useState, useEffect } from 'react';

// Your actual device data from Uptime Kuma backup
const deviceData = {
  "1st Floor": {
    accessPoints: [
      { id: 1, name: "AP4 (Bunker)", ip: "192.168.31.175", status: "up" },
      { id: 5, name: "AP1 (Gaming Room)", ip: "192.168.30.78", status: "up" },
      { id: 6, name: "AP2 (Above Wembley)", ip: "192.168.30.73", status: "up" },
      { id: 7, name: "AP3 (Above Security)", ip: "192.168.30.75", status: "down" },
      { id: 8, name: "AP5 (Sales Supply)", ip: "192.168.30.72", status: "up" },
      { id: 9, name: "AP6 (N2)", ip: "192.168.30.74", status: "up" }
    ],
    printers: [
      { id: 2, name: "Bunker Printer", ip: "192.168.33.33", status: "up" },
      { id: 10, name: "Kitchen Printer", ip: "192.168.33.38", status: "up" }
    ],
    polyLens: [
      { id: 32, name: "CIO", ip: "192.168.24.111", status: "up" },
      { id: 33, name: "Sales Supply", ip: "192.168.24.79", status: "up" },
      { id: 34, name: "IL BIZ", ip: "192.168.24.78", status: "down" },
      { id: 35, name: "Guy Yagur Conf.", ip: "192.168.24.147", status: "up" },
      { id: 36, name: "Jordan", ip: "192.168.24.216", status: "up" },
      { id: 37, name: "Wembley", ip: "192.168.24.150", status: "up" },
      { id: 38, name: "Camp Nou", ip: "192.168.24.149", status: "up" },
      { id: 39, name: "Santiago Bernabeu", ip: "192.168.24.148", status: "up" },
      { id: 62, name: "Global hubs1", ip: "192.168.24.153", status: "up" },
      { id: 63, name: "Serena", ip: "192.168.24.153", status: "up" },
      { id: 64, name: "Global hubs2", ip: "192.168.24.154", status: "up" },
      { id: 65, name: "San Siro", ip: "192.168.24.155", status: "up" },
      { id: 66, name: "Old Trafford", ip: "192.168.24.156", status: "up" }
    ]
  },
  "2nd Floor": {
    accessPoints: [
      { id: 11, name: "AP (Above P&C)", ip: "192.168.30.77", status: "up" },
      { id: 12, name: "AP (Bunker)", ip: "192.168.31.44", status: "up" },
      { id: 13, name: "AP1 (CX Supply)", ip: "192.168.31.95", status: "up" },
      { id: 14, name: "AP3 (MIS)", ip: "192.168.31.96", status: "up" },
      { id: 15, name: "AP4 (Asaf Porat)", ip: "192.168.31.185", status: "up" }
    ],
    printers: [
      { id: 16, name: "Bunker Printer", ip: "192.168.33.30", status: "up" },
      { id: 17, name: "Storage Printer", ip: "192.168.33.35", status: "maintenance" }
    ],
    polyLens: [
      { id: 40, name: "P&C1", ip: "192.168.26.42", status: "up" },
      { id: 41, name: "P&C2", ip: "192.168.24.196", status: "up" },
      { id: 42, name: "MIS", ip: "192.168.24.97", status: "up" },
      { id: 43, name: "Global Supply", ip: "192.168.24.199", status: "up" },
      { id: 44, name: "The Beatles", ip: "192.168.24.197", status: "up" },
      { id: 45, name: "CX Supply", ip: "192.168.24.198", status: "up" },
      { id: 46, name: "Acquisitions", ip: "192.168.24.200", status: "up" },
      { id: 47, name: "GYM", ip: "192.168.24.201", status: "up" },
      { id: 48, name: "Anfield", ip: "192.168.24.202", status: "up" },
      { id: 49, name: "Emirates", ip: "192.168.24.203", status: "down" }
    ]
  },
  "3rd Floor": {
    accessPoints: [
      { id: 18, name: "AP1 (Gamers)", ip: "192.168.31.78", status: "up" },
      { id: 19, name: "AP2 (Nemo)", ip: "192.168.30.179", status: "up" },
      { id: 20, name: "AP4 (Finance)", ip: "192.168.31.3", status: "up" },
      { id: 21, name: "AP5 (Above Hadas)", ip: "192.168.31.111", status: "up" },
      { id: 22, name: "South AP", ip: "192.168.30.141", status: "up" }
    ],
    printers: [
      { id: 23, name: "Storage Printer", ip: "192.168.33.66", status: "up" }
    ],
    polyLens: [
      { id: 50, name: "Cloud Platform1", ip: "192.168.25.5", status: "up" },
      { id: 51, name: "Finance", ip: "192.168.24.75", status: "up" },
      { id: 52, name: "Cloud Platform2", ip: "192.168.25.31", status: "up" },
      { id: 53, name: "Avatar", ip: "192.168.25.16", status: "up" },
      { id: 54, name: "Nemo", ip: "192.168.24.88", status: "up" }
    ]
  },
  "5th Floor": {
    accessPoints: [
      { id: 24, name: "Bunker AP", ip: "192.168.30.87", status: "up" },
      { id: 25, name: "Kantina AP", ip: "192.168.30.82", status: "up" },
      { id: 26, name: "North Side AP", ip: "192.168.30.244", status: "up" },
      { id: 27, name: "South Side AP", ip: "192.168.31.105", status: "up" },
      { id: 28, name: "West Side AP", ip: "192.168.30.173", status: "up" }
    ],
    printers: [
      { id: 29, name: "Storage Printer", ip: "192.168.33.40", status: "up" }
    ],
    polyLens: [
      { id: 55, name: "Achla", ip: "192.168.26.90", status: "up" },
      { id: 56, name: "Tachles", ip: "192.168.24.174", status: "up" },
      { id: 57, name: "Sababa", ip: "192.168.24.130", status: "up" },
      { id: 58, name: "Al-Hakefak", ip: "192.168.24.151", status: "up" },
      { id: 59, name: "Yalla", ip: "192.168.25.111", status: "up" }
    ]
  }
};

// Device type icons and colors
const deviceTypes = {
  accessPoints: { icon: "📡", label: "Access Points", color: "#3B82F6" },
  printers: { icon: "🖨️", label: "Printers", color: "#8B5CF6" },
  polyLens: { icon: "📹", label: "Zoom Rooms", color: "#F59E0B" }
};

const statusColors = {
  up: { bg: "#22C55E", pulse: "#4ADE80", label: "Online" },
  down: { bg: "#EF4444", pulse: "#F87171", label: "Offline" },
  maintenance: { bg: "#F59E0B", pulse: "#FBBF24", label: "Maintenance" }
};

// Simulated floor plan positions (random but consistent)
const generatePositions = (count, seed) => {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (seed + i * 137.5) % 360;
    const radius = 25 + ((seed * i) % 20);
    positions.push({
      x: 50 + radius * Math.cos(angle * Math.PI / 180) * 0.8,
      y: 50 + radius * Math.sin(angle * Math.PI / 180) * 0.6
    });
  }
  return positions;
};

export default function StatusDashboard() {
  const [activeFloor, setActiveFloor] = useState("1st Floor");
  const [hoveredDevice, setHoveredDevice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [showLegend, setShowLegend] = useState(true);

  const floors = Object.keys(deviceData);
  const currentFloorData = deviceData[activeFloor];

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Count devices by status
  const getStatusCounts = (floorData) => {
    let up = 0, down = 0, maintenance = 0;
    Object.values(floorData).forEach(category => {
      category.forEach(device => {
        if (device.status === 'up') up++;
        else if (device.status === 'down') down++;
        else maintenance++;
      });
    });
    return { up, down, maintenance, total: up + down + maintenance };
  };

  const currentCounts = getStatusCounts(currentFloorData);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      color: '#F8FAFC',
      padding: '24px',
      boxSizing: 'border-box'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid rgba(148, 163, 184, 0.2)'
      }}>
        <div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: '600',
            margin: 0,
            background: 'linear-gradient(90deg, #60A5FA, #A78BFA)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            🏢 Office Infrastructure Monitor
          </h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: '14px' }}>
            Real-time status • Last updated: {lastUpdate.toLocaleTimeString()}
          </p>
        </div>
        
        {/* Global Status Summary */}
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '12px',
            padding: '12px 20px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#22C55E' }}>
              {currentCounts.up}
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>Online</div>
          </div>
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '12px 20px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#EF4444' }}>
              {currentCounts.down}
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>Offline</div>
          </div>
        </div>
      </header>

      {/* Floor Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px'
      }}>
        {floors.map(floor => {
          const counts = getStatusCounts(deviceData[floor]);
          const isActive = floor === activeFloor;
          const hasIssues = counts.down > 0;
          
          return (
            <button
              key={floor}
              onClick={() => setActiveFloor(floor)}
              style={{
                flex: 1,
                padding: '16px 24px',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: isActive 
                  ? 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)'
                  : 'rgba(30, 41, 59, 0.8)',
                color: isActive ? '#FFFFFF' : '#94A3B8',
                fontSize: '16px',
                fontWeight: '500',
                position: 'relative',
                boxShadow: isActive ? '0 4px 20px rgba(59, 130, 246, 0.3)' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {floor}
                {hasIssues && (
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#EF4444',
                    animation: 'pulse 2s infinite'
                  }} />
                )}
              </div>
              <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
                {counts.total} devices
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div style={{ display: 'flex', gap: '24px' }}>
        {/* Floor Plan Area */}
        <div style={{
          flex: 1,
          background: 'rgba(30, 41, 59, 0.6)',
          borderRadius: '16px',
          padding: '24px',
          position: 'relative',
          minHeight: '500px',
          border: '1px solid rgba(148, 163, 184, 0.1)'
        }}>
          {/* Floor Plan Placeholder */}
          <div style={{
            position: 'absolute',
            inset: '24px',
            background: 'linear-gradient(180deg, rgba(51, 65, 85, 0.3) 0%, rgba(30, 41, 59, 0.5) 100%)',
            borderRadius: '12px',
            border: '2px dashed rgba(148, 163, 184, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ textAlign: 'center', color: '#64748B' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
              <div style={{ fontSize: '18px', fontWeight: '500' }}>
                {activeFloor} Blueprint
              </div>
              <div style={{ fontSize: '14px', marginTop: '4px' }}>
                Upload your PDF floor plan here
              </div>
            </div>
          </div>

          {/* Device Markers */}
          {Object.entries(currentFloorData).map(([type, devices]) => {
            const positions = generatePositions(devices.length, type.charCodeAt(0) * 7);
            return devices.map((device, idx) => {
              const pos = positions[idx];
              const status = statusColors[device.status];
              const typeInfo = deviceTypes[type];
              const isHovered = hoveredDevice?.id === device.id;
              
              return (
                <div
                  key={device.id}
                  onMouseEnter={() => setHoveredDevice(device)}
                  onMouseLeave={() => setHoveredDevice(null)}
                  style={{
                    position: 'absolute',
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: isHovered ? 100 : 10,
                    cursor: 'pointer'
                  }}
                >
                  {/* Pulse animation for down devices */}
                  {device.status === 'down' && (
                    <div style={{
                      position: 'absolute',
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: status.pulse,
                      opacity: 0.4,
                      animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                      transform: 'translate(-50%, -50%)',
                      left: '50%',
                      top: '50%'
                    }} />
                  )}
                  
                  {/* Device Dot */}
                  <div style={{
                    width: isHovered ? '28px' : '24px',
                    height: isHovered ? '28px' : '24px',
                    borderRadius: '50%',
                    background: status.bg,
                    border: `3px solid ${typeInfo.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    transition: 'all 0.2s ease',
                    boxShadow: isHovered 
                      ? `0 0 20px ${status.bg}` 
                      : `0 2px 8px rgba(0,0,0,0.3)`
                  }}>
                    {typeInfo.icon.slice(0, 2)}
                  </div>

                  {/* Hover Popup */}
                  {isHovered && (
                    <div style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      marginBottom: '12px',
                      background: 'linear-gradient(135deg, #1E293B 0%, #334155 100%)',
                      borderRadius: '12px',
                      padding: '16px',
                      minWidth: '220px',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                      zIndex: 1000
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px'
                      }}>
                        <span style={{ fontSize: '20px' }}>{typeInfo.icon}</span>
                        <span style={{ fontWeight: '600', fontSize: '14px' }}>
                          {device.name}
                        </span>
                      </div>
                      
                      <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                        <div style={{ marginBottom: '6px' }}>
                          <strong>Type:</strong> {typeInfo.label}
                        </div>
                        <div style={{ marginBottom: '6px' }}>
                          <strong>IP:</strong> {device.ip}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <strong>Status:</strong>
                          <span style={{
                            background: status.bg,
                            color: '#FFF',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600'
                          }}>
                            {status.label}
                          </span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div style={{
                        position: 'absolute',
                        bottom: '-8px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '8px solid transparent',
                        borderRight: '8px solid transparent',
                        borderTop: '8px solid #334155'
                      }} />
                    </div>
                  )}
                </div>
              );
            });
          })}
        </div>

        {/* Sidebar - Device List */}
        <div style={{
          width: '320px',
          background: 'rgba(30, 41, 59, 0.6)',
          borderRadius: '16px',
          padding: '20px',
          border: '1px solid rgba(148, 163, 184, 0.1)',
          maxHeight: '600px',
          overflowY: 'auto'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: '#E2E8F0' }}>
            📋 Device List - {activeFloor}
          </h3>

          {Object.entries(currentFloorData).map(([type, devices]) => {
            const typeInfo = deviceTypes[type];
            return (
              <div key={type} style={{ marginBottom: '20px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '10px',
                  padding: '8px 12px',
                  background: `${typeInfo.color}20`,
                  borderRadius: '8px',
                  borderLeft: `3px solid ${typeInfo.color}`
                }}>
                  <span>{typeInfo.icon}</span>
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>
                    {typeInfo.label}
                  </span>
                  <span style={{
                    marginLeft: 'auto',
                    background: 'rgba(0,0,0,0.2)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>
                    {devices.length}
                  </span>
                </div>
                
                {devices.map(device => {
                  const status = statusColors[device.status];
                  return (
                    <div
                      key={device.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        marginBottom: '4px',
                        background: device.status === 'down' 
                          ? 'rgba(239, 68, 68, 0.1)' 
                          : 'rgba(51, 65, 85, 0.3)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={() => setHoveredDevice(device)}
                      onMouseLeave={() => setHoveredDevice(null)}
                    >
                      <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: status.bg,
                        boxShadow: device.status === 'down' 
                          ? `0 0 8px ${status.bg}` 
                          : 'none'
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {device.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748B' }}>
                          {device.ip}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '32px',
        marginTop: '24px',
        padding: '16px',
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📡</span>
          <span style={{ color: '#3B82F6', fontSize: '14px' }}>Access Points</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🖨️</span>
          <span style={{ color: '#8B5CF6', fontSize: '14px' }}>Printers</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📹</span>
          <span style={{ color: '#F59E0B', fontSize: '14px' }}>Zoom Rooms</span>
        </div>
        <div style={{ marginLeft: '24px', display: 'flex', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22C55E' }} />
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>Online</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#EF4444' }} />
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>Offline</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#F59E0B' }} />
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>Maintenance</span>
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes ping {
          75%, 100% {
            transform: translate(-50%, -50%) scale(2);
            opacity: 0;
          }
        }
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
      `}</style>
    </div>
  );
}
