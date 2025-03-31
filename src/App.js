import React, { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HttpTransportType } from '@microsoft/signalr';
import LoginPage from './LoginPage';

const App = () => {
  const [userId, setUserId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [targetUserId, setTargetUserId] = useState('');
  const [currentCallUserId, setCurrentCallUserId] = useState(''); 
  const [incomingCall, setIncomingCall] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [callStatus, setCallStatus] = useState('No Call');
  const [errorMessage, setErrorMessage] = useState('');
  const [audioStreamStats, setAudioStreamStats] = useState(null);
  
  const peerConnection = useRef(null);
  const connection = useRef(null);
  const localStreamRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const statsInterval = useRef(null);

  // Process queued ICE candidates when currentCallUserId changes
  useEffect(() => {
    if (currentCallUserId && iceCandidatesQueue.current.length > 0) {
      console.log(`Processing queue: Found ${iceCandidatesQueue.current.length} ICE candidates to send to ${currentCallUserId}`);
      
      const candidatesToSend = [...iceCandidatesQueue.current];
      iceCandidatesQueue.current = [];
      
      candidatesToSend.forEach((candidate, index) => {
        console.log(`Sending queued ICE candidate ${index + 1}/${candidatesToSend.length} to ${currentCallUserId}`);
        sendIceCandidate(currentCallUserId, candidate);
      });
      
      console.log('ICE candidate queue processed successfully');
    }
  }, [currentCallUserId]);

  // Manage statistics collection
  useEffect(() => {
    if (callStatus === 'Connected' && peerConnection.current) {
      statsInterval.current = setInterval(async () => {
        try {
          const stats = await peerConnection.current.getStats();
          let audioStats = {};
          
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              audioStats = {
                bytesReceived: report.bytesReceived,
                packetsReceived: report.packetsReceived,
                packetsLost: report.packetsLost,
                jitter: report.jitter,
                timestamp: report.timestamp
              };
            }
          });
          
          if (Object.keys(audioStats).length > 0) {
            setAudioStreamStats(audioStats);
          }
        } catch (err) {
          console.log('Error getting WebRTC stats:', err);
        }
      }, 5000);
    } else {
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
        statsInterval.current = null;
      }
    }
    
    return () => {
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
        statsInterval.current = null;
      }
    };
  }, [callStatus]);

  // Setup SignalR connection and event handlers
  useEffect(() => {
    if (!userId) return;

    connection.current = new HubConnectionBuilder()
      .withUrl(`https://tellory.id.vn/callhub?userId=${userId}`, {
        transport: HttpTransportType.WebSockets,
        skipNegotiation: true
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .build();

    connection.current.onreconnecting(error => {
      console.log('SignalR reconnecting due to error:', error);
      setConnectionStatus('Reconnecting');
    });

    connection.current.onreconnected(connectionId => {
      console.log('SignalR reconnected with connectionId:', connectionId);
      setConnectionStatus('Connected');
    });

    connection.current.onclose((error) => {
      console.log('SignalR Disconnected:', error);
      setConnectionStatus('Disconnected');
      
      if (callStatus !== 'No Call') {
        endCall();
      }
    });

    // Register SignalR event handlers
    connection.current.on('ReceiveOffer', handleReceiveOffer);
    connection.current.on('ReceiveAnswer', handleReceiveAnswer);
    connection.current.on('ReceiveIceCandidate', handleReceiveIceCandidate);
    connection.current.on('Error', handleServerError);
    connection.current.on('CallEnded', handleCallEnded);

    connection.current.start()
      .then(() => {
        console.log('SignalR Connected with connectionId:', connection.current.connectionId);
        setConnectionStatus('Connected');
      })
      .catch(err => {
        console.error('SignalR Connection Error:', err);
        setConnectionStatus('Error');
        setErrorMessage(`Connection error: ${err.message}`);
      });

    initializeAudioStream();

    return () => {
      console.log('Cleaning up resources on component unmount');
      
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
      }
      
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      
      if (connection.current) {
        connection.current.stop();
      }
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log('Stopping local track:', track.kind, track.id);
          track.stop();
        });
      }

      iceCandidatesQueue.current = [];
    };
  }, [userId]);

  const initializeAudioStream = async () => {
    try {
      console.log('Requesting audio stream...');
      const constraints = { 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('Audio stream obtained with tracks:', stream.getTracks().map(t => t.kind));
      localStreamRef.current = stream;
      setLocalStream(stream);
      
      // Test audio levels
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      console.log('Initial audio level:', average);
      
      if (average < 10) {
        console.warn('Audio levels are very low. Microphone might be muted or not working properly.');
      }
      
      setTimeout(() => {
        if (audioContext.state !== 'closed') {
          audioContext.close().catch(err => console.error('Error closing AudioContext:', err));
        }
      }, 1000);
      
    } catch (error) {
      console.error('Error accessing media devices:', error);
      
      if (error.name === 'NotAllowedError') {
        setErrorMessage('Microphone access denied. Please allow microphone permissions.');
      } else if (error.name === 'NotFoundError') {
        setErrorMessage('No microphone found. Please connect a microphone and try again.');
      } else {
        setErrorMessage(`Microphone error: ${error.message}`);
      }
    }
  };

  // Handler for when the remote user ends the call
  const handleCallEnded = (fromUserId) => {
    console.log('Call ended by user:', fromUserId);
    
    if (callStatus !== 'No Call') {
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      
      setCallStatus('No Call');
      setCurrentCallUserId('');
      setErrorMessage(`Call ended by the other user`);
      setAudioStreamStats(null);
      
      iceCandidatesQueue.current = [];
    }
  };

  // Function to end the call and notify the other party
  const endCall = async () => {
    console.log('Ending call with user:', currentCallUserId);
    
    // Notify other user if we're in a call and have a connection
    if (currentCallUserId && connection.current?.state === 'Connected') {
      try {
        console.log('Sending call end notification to:', currentCallUserId);
        await connection.current.invoke('EndCall', currentCallUserId);
      } catch (err) {
        console.error('Error sending call end notification:', err);
      }
    }
    
    // Close local peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    
    setCallStatus('No Call');
    setCurrentCallUserId('');
    setErrorMessage('');
    setAudioStreamStats(null);
    
    iceCandidatesQueue.current = [];
  };

  const createPeerConnection = () => {
    console.log('Creating PeerConnection...');
    
    if (iceCandidatesQueue.current.length > 0) {
      console.log(`Clearing ${iceCandidatesQueue.current.length} queued ICE candidates when creating new connection`);
      iceCandidatesQueue.current = [];
    }
    
    if (peerConnection.current) {
      console.log('Closing existing PeerConnection');
      peerConnection.current.close();
    }
    
    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10
    });

    const newRemoteStream = new MediaStream();
    setRemoteStream(newRemoteStream);

    console.log('Local stream tracks to add:', localStream?.getTracks().map(t => t.kind));
    if (localStream?.getTracks().length === 0) {
      console.warn('No tracks in local stream to add to peer connection!');
    }
    
    localStream?.getTracks().forEach(track => {
      console.log(`Adding ${track.kind} track to PeerConnection`, track.id);
      peerConnection.current.addTrack(track, localStream);
    });

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateInfo = event.candidate.candidate.split(' ');
        const foundation = candidateInfo[0].substring(10);
        const candidateType = candidateInfo[7];
        const ipAddress = candidateInfo[4];
        const port = candidateInfo[5];
        
        console.log(`Generated ICE Candidate (${candidateType}, ${ipAddress}:${port}, foundation: ${foundation})`);
        
        if (currentCallUserId) {
          sendIceCandidate(currentCallUserId, event.candidate);
        } else {
          console.log(`Queueing ICE candidate (${candidateType}). Queue size: ${iceCandidatesQueue.current.length + 1}`);
          iceCandidatesQueue.current.push(event.candidate);
        }
      } else {
        console.log('ICE candidate generation completed. Total queued candidates:', iceCandidatesQueue.current.length);
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      const state = peerConnection.current.connectionState;
      console.log('Peer Connection state changed to:', state);
      
      if (state === 'connected') {
        console.log('Peer connection established successfully!');
      } else if (state === 'failed') {
        console.error('Peer connection failed');
        setErrorMessage('Connection failed. You may need to use a TURN server for NAT traversal.');
      } else if (state === 'disconnected' || state === 'closed') {
        console.log('Peer connection closed or disconnected');
      }
    };

    peerConnection.current.oniceconnectionstatechange = () => {
      const state = peerConnection.current.iceConnectionState;
      console.log('ICE Connection State changed to:', state);
      
      switch (state) {
        case 'connected':
          console.log('ICE connection established! Media should be flowing now.');
          setCallStatus('Connected');
          setErrorMessage('');
          break;
        case 'completed':
          console.log('ICE connection completed! All ICE candidates have been found.');
          setCallStatus('Connected');
          setErrorMessage('');
          break;
        case 'disconnected':
          console.log('ICE connection temporarily disconnected');
          setCallStatus('Disconnected');
          setErrorMessage('Call temporarily disconnected. Trying to reconnect...');
          break;
        case 'failed':
          console.error('ICE connection failed. This could be due to firewall or NAT issues.');
          setCallStatus('Failed');
          setErrorMessage('Call connection failed. Please try again or use a better network.');
          break;
        case 'closed':
          console.log('ICE connection closed by application');
          setCallStatus('No Call');
          setCurrentCallUserId('');
          setErrorMessage('');
          break;
        default:
          console.log(`ICE connection in ${state} state`);
          setCallStatus('Connecting...');
      }
    };

    peerConnection.current.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.current.iceGatheringState);
    };

    peerConnection.current.ontrack = (event) => {
      console.log(`Remote ${event.track.kind} track received:`, event.track.id);
      console.log('Remote stream ID:', event.streams[0].id);
      console.log('Remote stream track count:', event.streams[0].getTracks().length);
      
      event.track.onmute = () => console.log('Remote track muted:', event.track.kind);
      event.track.onunmute = () => console.log('Remote track unmuted:', event.track.kind);
      event.track.onended = () => console.log('Remote track ended:', event.track.kind);
      
      event.streams[0].getTracks().forEach(track => {
        console.log('Adding track to remote stream:', track.kind, track.id);
        newRemoteStream.addTrack(track);
        
        if (track.kind === 'audio') {
          try {
            if ('contentHint' in track) {
              track.contentHint = 'speech';
            }
          } catch (err) {
            console.warn('Could not set content hint on audio track:', err);
          }
        }
      });
    };
  };

  const sendIceCandidate = async (receiverId, candidate) => {
    if (connection.current?.state !== 'Connected') {
      console.error('Cannot send ICE candidate: SignalR not connected');
      return;
    }

    if (!receiverId) {
      console.error('Cannot send ICE candidate: Receiver ID is empty');
      return;
    }

    try {
      const candidateInfo = candidate.candidate.split(' ');
      const candidateType = candidateInfo[7];
      
      const candidateJson = JSON.stringify(candidate);
      console.log(`Sending ICE Candidate (${candidateType}) to ${receiverId}`);
      await connection.current.invoke('SendIceCandidate', receiverId, candidateJson);
    } catch (err) {
      console.error('Failed to send ICE candidate:', err);
      if (err.message.includes('disconnected') || err.message.includes('not connected')) {
        setConnectionStatus('Disconnected');
        setErrorMessage('Connection to server lost. Please refresh and try again.');
      } else {
        setErrorMessage(`ICE candidate error: ${err.message}`);
      }
    }
  };

  const startCall = async () => {
    setErrorMessage('');
    console.log('Starting call to:', targetUserId);
    
    if (!localStream) {
      const error = 'Local stream is not available.';
      console.error(error);
      setErrorMessage(error);
      return;
    }

    if (connection.current?.state !== 'Connected') {
      const error = 'SignalR connection is not connected.';
      console.error(error);
      setErrorMessage(error);
      return;
    }

    if (!targetUserId) {
      const error = 'Target user ID is empty.';
      console.error(error);
      setErrorMessage(error);
      return;
    }

    setCallStatus('Calling...');

    try {
      createPeerConnection();
      
      setCurrentCallUserId(targetUserId);
      
      const offer = await peerConnection.current.createOffer({
        offerToReceiveAudio: true,
        voiceActivityDetection: true
      });
      
      console.log('Created Offer:', offer);
      await peerConnection.current.setLocalDescription(offer);
      console.log('Local description set successfully');

      const offerJson = JSON.stringify(offer);
      console.log('Sending Offer to Target User ID:', targetUserId);
      await connection.current.invoke('SendOffer', targetUserId, offerJson);
      console.log('Offer sent successfully');
    } catch (err) {
      console.error('Error starting call:', err);
      setCallStatus('Failed');
      setCurrentCallUserId('');
      setErrorMessage(`Call error: ${err.message}`);
    }
  };

  const acceptCall = async () => {
    setErrorMessage('');
    console.log('Accepting call from:', incomingCall?.fromUserId);
    
    if (!incomingCall) return;
    const { offer, fromUserId } = incomingCall;

    setCallStatus('Connecting...');

    try {
      createPeerConnection();
      setCurrentCallUserId(fromUserId);
      
      const offerObj = typeof offer === 'string' ? JSON.parse(offer) : offer;
      console.log('Setting Remote Description with Offer:', offerObj);
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offerObj));
      console.log('Remote description set successfully');

      const answer = await peerConnection.current.createAnswer({
        voiceActivityDetection: true
      });
      
      console.log('Created Answer:', answer);
      await peerConnection.current.setLocalDescription(answer);
      console.log('Local description set successfully');

      const answerJson = JSON.stringify(answer);
      console.log('Sending Answer to User ID:', fromUserId);
      await connection.current.invoke('SendAnswer', fromUserId, answerJson);
      console.log('Answer sent successfully');
      
      setIncomingCall(null);
    } catch (err) {
      console.error('Error accepting call:', err);
      setCallStatus('Failed');
      setCurrentCallUserId('');
      setErrorMessage(`Accept call error: ${err.message}`);
    }
  };

  const rejectCall = () => {
    console.log('Call rejected from user:', incomingCall?.fromUserId);
    setIncomingCall(null);
  };

  const handleReceiveOffer = (offer, fromUserId) => {
    console.log('Received Offer from User ID:', fromUserId);
    
    if (callStatus !== 'No Call') {
      console.log(`Already in a call with ${currentCallUserId}, ignoring offer from ${fromUserId}`);
      return;
    }
    
    const offerObj = typeof offer === 'string' ? JSON.parse(offer) : offer;
    console.log('Parsed Offer SDP:', offerObj.sdp.substring(0, 100) + '...');
    
    setIncomingCall({ offer: offerObj, fromUserId });
  };

  const handleReceiveAnswer = async (answer) => {
    console.log('Received Answer from remote user');
    
    try {
      if (!peerConnection.current) {
        console.error('PeerConnection is null when receiving answer');
        return;
      }
      
      const answerObj = typeof answer === 'string' ? JSON.parse(answer) : answer;
      console.log('Parsed Answer SDP:', answerObj.sdp.substring(0, 100) + '...');
      
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answerObj));
      console.log('Remote description (answer) set successfully');
    } catch (err) {
      console.error('Error handling answer:', err);
      setErrorMessage(`Answer error: ${err.message}`);
    }
  };

  const handleReceiveIceCandidate = async (candidate) => {
    console.log('Received ICE Candidate from server');
    
    try {
      if (!peerConnection.current) {
        console.error('PeerConnection is null when receiving ICE candidate');
        return;
      }
      
      const candidateObj = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      
      const candidateInfo = candidateObj.candidate.split(' ');
      const candidateType = candidateInfo[7];
      console.log(`Parsed ICE Candidate (${candidateType}):`);
      
      console.log('Adding ICE candidate to peer connection');
      await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidateObj));
      console.log('ICE candidate added successfully');
    } catch (err) {
      console.error('Error handling ICE candidate:', err);
    }
  };

  const handleServerError = (errorMessage) => {
    console.error('Server Error:', errorMessage);
    setErrorMessage(`Server Error: ${errorMessage}`);
    
    if (errorMessage.includes('is not connected')) {
      setCallStatus('Failed');
      setTimeout(() => {
        endCall();
      }, 2000);
    }
  };

  if (!userId) return <LoginPage onLogin={setUserId} />;
  
  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '5px' }}>
        <h2 style={{ margin: '0 0 10px 0' }}>WebRTC Audio Call</h2>
        <p><strong>Your ID:</strong> {userId}</p>
        <p><strong>Connection Status:</strong> <span style={{ color: connectionStatus === 'Connected' ? 'green' : connectionStatus === 'Reconnecting' ? 'orange' : 'red' }}>{connectionStatus}</span></p>
        {currentCallUserId && <p><strong>In call with:</strong> {currentCallUserId}</p>}
        {callStatus !== 'No Call' && <p><strong>Call Status:</strong> <span style={{ color: callStatus === 'Connected' ? 'green' : callStatus === 'Failed' ? 'red' : 'orange' }}>{callStatus}</span></p>}
        
        {audioStreamStats && callStatus === 'Connected' && (
          <div style={{ fontSize: '12px', margin: '5px 0', color: '#666' }}>
            <p style={{ margin: '3px 0' }}><strong>Audio Stats:</strong> Packets: {audioStreamStats.packetsReceived} | Lost: {audioStreamStats.packetsLost || 0} | Jitter: {(audioStreamStats.jitter * 1000).toFixed(2)}ms</p>
          </div>
        )}
        
        {errorMessage && (
          <div style={{ padding: '10px', backgroundColor: '#ffeeee', color: 'red', borderRadius: '4px', marginTop: '10px' }}>
            <strong>Error:</strong> {errorMessage}
          </div>
        )}
      </div>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          style={{ padding: '8px', flex: 1, borderRadius: '4px', border: '1px solid #ccc' }}
          type="text"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          placeholder="Enter target user ID"
          disabled={callStatus !== 'No Call'}
        />
        {callStatus === 'No Call' ? (
          <button 
            style={{ 
              padding: '8px 16px', 
              backgroundColor: 'green', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: targetUserId && connectionStatus === 'Connected' ? 'pointer' : 'not-allowed'
            }}
            onClick={startCall} 
            disabled={!targetUserId || connectionStatus !== 'Connected'}
          >
            Start Call
          </button>
        ) : (
          <button 
            style={{ 
              padding: '8px 16px', 
              backgroundColor: 'red', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
            onClick={endCall}
          >
            End Call
          </button>
        )}
      </div>
      
      {incomingCall && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px', backgroundColor: '#f0f8ff' }}>
          <p><strong>Incoming call from:</strong> {incomingCall.fromUserId}</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              style={{ padding: '8px 16px', backgroundColor: 'green', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }} 
              onClick={acceptCall}
            >
              Accept
            </button>
            <button 
              style={{ padding: '8px 16px', backgroundColor: 'red', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }} 
              onClick={rejectCall}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {remoteStream && (
          <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
            <p><strong>Remote Audio:</strong></p>
            <audio
              style={{ width: '100%' }}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={() => console.log('Remote audio stream loaded and ready to play')}
              ref={(audio) => {
                if (audio) {
                  audio.srcObject = remoteStream;
                  console.log('Remote audio element updated with stream');
                  
                  audio.play()
                    .then(() => console.log('Remote audio playback started automatically'))
                    .catch(err => {
                      console.warn('Auto-play prevented:', err);
                      setErrorMessage('Click the play button to hear audio');
                    });
                }
              }}
            />
            <div style={{ fontSize: '12px', color: 'gray', marginTop: '5px' }}>
              {remoteStream.getTracks().map(track => (
                <div key={track.id}>
                  Track {track.kind}: {track.enabled ? 'Enabled' : 'Disabled'}, Muted: {track.muted ? 'Yes' : 'No'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;