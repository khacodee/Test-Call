import * as signalR from "@microsoft/signalr";

export let connection = null;

// ✅ Khởi tạo kết nối SignalR
export const startConnection = async () => {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    console.log("✅ SignalR đã kết nối.");
    return;
  }

  connection = new signalR.HubConnectionBuilder()
    .withUrl("https://tellory.id.vn/hub", {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000]) // 🔹 Reconnect sau 0s, 2s, 5s, 10s
    .build();

  connection.onreconnecting((error) => {
    console.warn("🔄 SignalR đang kết nối lại...", error);
  });

  connection.onreconnected((connectionId) => {
    console.log(`✅ SignalR đã kết nối lại: ${connectionId}`);
  });

  connection.onclose(async (error) => {
    console.error("❌ SignalR bị đóng:", error);
    if (error) {
      console.log("⏳ Thử kết nối lại sau 5s...");
      setTimeout(startConnection, 5000); // 🔹 Thử kết nối lại sau 5s
    }
  });

  try {
    await connection.start();
    console.log("✅ SignalR đã kết nối.");
     connection.on("ReceiveMessage", (message) => {
      console.log("🕒 Message:", message);
    });
    connection.on("ReceiveTimeServer", (time) => {
      console.log("🕒 Thời gian từ server:", time);
    });
  } catch (error) {
    console.error("❌ Lỗi kết nối SignalR:", error);
    setTimeout(startConnection, 5000);
  }
};

// ⛔ Dừng kết nối SignalR
export const stopConnection = async () => {
  if (connection) {
    try {
      await connection.stop();
      console.log("⛔ SignalR đã ngắt kết nối.");
    } catch (error) {
      console.error("❌ Lỗi khi ngắt kết nối SignalR:", error);
    } finally {
      connection = null;
    }
  }
};

// 📥 Lắng nghe tin nhắn từ server
export const onMessage = (eventName, callback) => {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    connection.off(eventName); // 🔹 Tránh trùng lặp
    connection.on(eventName, callback);
  } else {
    console.error(`❌ Không thể lắng nghe sự kiện "${eventName}": Chưa kết nối.`);
  }
};

// 📤 Gửi tin nhắn tới server
export const sendMessage = async (eventName, ...args) => {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    try {
      await connection.invoke(eventName, ...args);
    } catch (error) {
      console.error(`❌ Lỗi khi gửi tin nhắn "${eventName}":`, error);
    }
  } else {
    console.error(`❌ Không thể gửi tin nhắn "${eventName}": Chưa kết nối.`);
  }
};
