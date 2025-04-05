import React, { useEffect, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";
import { AppBar, Toolbar, Typography, Button, TextField, Card, CardContent, Grid } from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";

const SERVER_URL = "https://tellory.id.vn/callhub";

const App = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peer = useRef(null);
  const [connection, setConnection] = useState(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // State for incoming call
  const iceCandidateQueue = useRef([]);
  const [isMicOn, setIsMicOn] = useState(true);
const [isVideoOn, setIsVideoOn] = useState(true);
  useEffect(() => {
    if (isLoggedIn) {
      // Thiết lập kết nối SignalR khi đã đăng nhập
      const newConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${SERVER_URL}?userId=${userId}`)
        .withAutomaticReconnect()
        .build();

      newConnection.start().catch(err => console.error("SignalR Connection Error: ", err));
      newConnection.on("CallEnded", (callerUserId) => {
      console.log(`Call ended by user: ${callerUserId}`);
      endCall(); // Kết thúc cuộc gọi ở phía client
    });
      // Xử lý sự kiện nhận tín hiệu từ server
      newConnection.on("ReceiveOffer", async (offer, callerUserId) => {
  try {
    console.log("Received offer from:", callerUserId);

    // Set the incoming call state
    setIncomingCall({ callerUserId, offer });

    // Thiết lập targetUserId từ callerUserId
    setTargetUserId(callerUserId);

    // Prepare WebRTC connection immediately
    if (!peer.current) {
      await setupWebRTC();
    }
  } catch (error) {
    console.error("Error handling incoming offer:", error);
  }
});


      newConnection.on("ReceiveAnswer", async (answer) => {
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      });

      

newConnection.on("ReceiveIceCandidate", (candidate) => {
  try {
    console.log("Nhận ICE candidate:", candidate);
    const iceCandidate = new RTCIceCandidate(JSON.parse(candidate));
    if (peer.current && peer.current.remoteDescription) {
      peer.current.addIceCandidate(iceCandidate);
    } else {
      console.warn("Remote description chưa được thiết lập. Đưa ICE candidate vào hàng đợi.");
      iceCandidateQueue.current.push(iceCandidate);
    }
  } catch (error) {
    console.error("Lỗi khi thêm ICE candidate:", error);
  }
});

      newConnection.on("CallEnded", () => {
        endCall();
      });

      // Handle incoming call
      newConnection.on("IncomingCall", (callerUserId) => {
        setIncomingCall(callerUserId);
      });

      setConnection(newConnection);
      return () => newConnection.stop();
    }
  }, [isLoggedIn, userId]);
const checkUserExists = async (userId) => {
  try {
    const userExists = await connection.invoke("CheckUserExists", userId);
    console.log(`User ${userId} exists: ${userExists}`);
    return userExists;
  } catch (error) {
    console.error("Error checking user existence:", error);
    return false;
  }
};
  const setupWebRTC = async () => {
  try {
    peer.current = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:tellory.id.vn:3478",
            username: "sep2025",
            credential: "sep2025",
          },
        ],
      });

   peer.current.onicecandidate = async (event) => {
  if (event.candidate && targetUserId) {
    console.log("Generated ICE candidate:", event.candidate);

    const userExists = await checkUserExists(targetUserId);
    if (!userExists) {
      console.warn(`Không thể gửi ICE candidate. User ${targetUserId} không kết nối.`);
      return;
    }

    console.log("Gửi ICE candidate đến:", targetUserId);
    connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate))
      .catch(err => console.error("Lỗi khi gửi ICE candidate:", err));
  } else {
    console.warn("ICE candidate không được gửi: targetUserId chưa được thiết lập.");
  }
};


    peer.current.ontrack = event => {
      remoteVideoRef.current.srcObject = event.streams[0];
    };

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(track => peer.current.addTrack(track, stream));
    localVideoRef.current.srcObject = stream;
  } catch (error) {
    console.error("Error accessing media devices:", error);
    // Display an error message to the user
    alert("Unable to access camera/microphone: " + error.message);
  }
};

const startCall = async () => {
  try {
    if (!targetUserId) {
      alert("Vui lòng nhập ID người dùng mục tiêu.");
      return;
    }
      const userExists = await checkUserExists(targetUserId);
    if (!userExists) {
      alert(`Người dùng với ID ${targetUserId} không tồn tại hoặc không trực tuyến.`);
      return;
    }
    // Thiết lập kết nối WebRTC
    await setupWebRTC();

    // Tạo offer và thiết lập local description
    const offer = await peer.current.createOffer();
    await peer.current.setLocalDescription(offer);

    // Gửi offer đến người dùng mục tiêu
    connection.invoke("SendOffer", targetUserId, JSON.stringify(offer))
      .catch(err => console.error("Lỗi khi gửi offer:", err));
  } catch (error) {
    console.error("Lỗi khi bắt đầu cuộc gọi:", error);
    alert("Không thể bắt đầu cuộc gọi. Vui lòng thử lại.");
  }
};

  const endCall = () => {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    localVideoRef.current.srcObject = null;
    remoteVideoRef.current.srcObject = null;
    if (connection && targetUserId) {
    connection.invoke("EndCall", targetUserId)
      .catch(err => console.error("Lỗi khi gửi thông báo kết thúc cuộc gọi:", err));
  }
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
  };
const acceptCall = async () => {
  try {
    console.log("Chấp nhận cuộc gọi từ:", incomingCall);

    // Thiết lập targetUserId
    setTargetUserId(incomingCall.callerUserId);

    // Thiết lập kết nối WebRTC
    await setupWebRTC();

    // Thiết lập remote description với offer nhận được
    await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(incomingCall.offer)));

    // Xử lý các ICE candidate trong hàng đợi
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      await peer.current.addIceCandidate(candidate);
    }

    // Tạo answer và thiết lập local description
    const answer = await peer.current.createAnswer();
    await peer.current.setLocalDescription(answer);

    // Gửi answer lại cho người gọi
    connection.invoke("SendAnswer", incomingCall.callerUserId, JSON.stringify(answer));

    // Xóa thông báo cuộc gọi đến
    setIncomingCall(null);
  } catch (error) {
    console.error("Lỗi khi chấp nhận cuộc gọi:", error);
    alert("Không thể chấp nhận cuộc gọi. Vui lòng thử lại.");
  }
};


  const rejectCall = () => {
    // Logic to reject the call
    console.log("Call rejected from:", incomingCall);
    setIncomingCall(null);
  };
const toggleMic = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const audioTracks = localVideoRef.current.srcObject.getAudioTracks();
      if (audioTracks.length > 0) {
        const isEnabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !isEnabled;
        setIsMicOn(!isEnabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const videoTracks = localVideoRef.current.srcObject.getVideoTracks();
      if (videoTracks.length > 0) {
        const isEnabled = videoTracks[0].enabled;
        videoTracks[0].enabled = !isEnabled;
        setIsVideoOn(!isEnabled);
      }
    }
  };

  return (
    <div>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" style={{ flexGrow: 1 }}>
            Zalo-like Video Call App
          </Typography>
          {isLoggedIn && (
            <Button color="inherit" onClick={() => setIsLoggedIn(false)}>
              Đăng xuất
            </Button>
          )}
        </Toolbar>
      </AppBar>

      {!isLoggedIn ? (
        <Grid container justifyContent="center" alignItems="center" style={{ height: "100vh" }}>
          <Card style={{ padding: "20px", width: "400px" }}>
            <CardContent>
              <Typography variant="h5" gutterBottom>
                Đăng nhập
              </Typography>
              <TextField
                fullWidth
                label="Nhập User ID"
                variant="outlined"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                style={{ marginBottom: "20px" }}
              />
              <Button variant="contained" color="primary" fullWidth onClick={() => setIsLoggedIn(true)}>
                Đăng nhập
              </Button>
            </CardContent>
          </Card>
        </Grid>
      ) : (
        <Grid container spacing={2} style={{ padding: "20px" }}>
          <Grid item xs={12} md={6}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: "10px" }} />
          </Grid>
          <Grid item xs={12} md={6}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", borderRadius: "10px" }} />
          </Grid>
          <Grid item xs={12}>
  <TextField
    fullWidth
    label="Nhập ID người dùng mục tiêu"
    variant="outlined"
    onChange={(e) => setTargetUserId(e.target.value)}
    style={{ marginBottom: "10px" }}
  />
  <Button variant="contained" color="primary" onClick={startCall} style={{ marginRight: "10px" }}>
    Gọi
  </Button>
  <Button variant="contained" color="secondary" onClick={endCall} style={{ marginRight: "10px" }}>
    Kết thúc
  </Button>
  <Button variant="outlined" color="primary" onClick={toggleMic} style={{ marginRight: "10px" }}>
    {isMicOn ? <MicIcon /> : <MicOffIcon />}
  </Button>
  <Button variant="outlined" color="primary" onClick={toggleVideo}>
    {isVideoOn ? <VideocamIcon /> : <VideocamOffIcon />}
  </Button>
</Grid>
          {incomingCall && (
            <Grid item xs={12}>
              <Card style={{ padding: "20px", marginTop: "20px" }}>
                <Typography variant="h6">Cuộc gọi đến từ: {incomingCall.callerUserId}</Typography>
                <Button variant="contained" color="primary" onClick={acceptCall} style={{ marginRight: "10px" }}>
                  Chấp nhận
                </Button>
                <Button variant="contained" color="secondary" onClick={rejectCall}>
                  Từ chối
                </Button>
              </Card>
            </Grid>
          )}
        </Grid>
      )}
    </div>
  );
};

export default App;