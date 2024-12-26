// video_container_widget.dart

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:js' as js;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:loading_animation_widget/loading_animation_widget.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../../../dashboard/viewmodel/user_viewmodel.dart';
import '../../repository/chat_repository.dart';
import '../../services/chat_service.dart';
import '../../services/websocket_service.dart';
import '../../viewmodel/chat_viewmodel.dart';
import 'animated_wave_form.dart';

class VideoContainerWidget extends StatelessWidget {
  final Widget child;
  final bool isUser;
  final bool isMicOn;
  final bool isVideoOn;
  final VoidCallback onMicToggle;
  final VoidCallback onVideoToggle;
  final double widthFactor;
  final ValueChanged<bool> micStateCallback;

  const VideoContainerWidget({
    Key? key,
    required this.child,
    required this.isUser,
    required this.isMicOn,
    required this.isVideoOn,
    required this.onMicToggle,
    required this.onVideoToggle,
    required this.widthFactor,
    required this.micStateCallback,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    double cardWidth = MediaQuery.of(context).size.width < 600
        ? double.infinity
        : MediaQuery.of(context).size.width / widthFactor;
    return Stack(
      alignment: Alignment.bottomCenter,
      children: [
        Container(
          width: cardWidth,
          height: MediaQuery.of(context).size.height / 1.9,
          margin: const EdgeInsets.all(8.0),
          decoration: BoxDecoration(
            color: Colors.grey[900],
            borderRadius: BorderRadius.circular(10),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: child,
          ),
        ),
        if (isUser)
          Positioned(
            bottom: 10,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: Icon(
                    isMicOn ? Icons.mic : Icons.mic_off,
                    color: Colors.white,
                  ),
                  onPressed: () {
                    onMicToggle();
                    micStateCallback(!isMicOn);
                  },
                ),
                IconButton(
                  icon: Icon(
                    isVideoOn ? Icons.videocam : Icons.videocam_off,
                    color: Colors.white,
                  ),
                  onPressed: onVideoToggle,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class ChatPanel extends StatefulWidget {
  final String scenarioId;
  final String botName;
  final String email;
  final String username;
  final String title;
  final String category;
  final String difficulty;
  final String mood;
  final String startmessage;
  final bool isMicOn;
  final bool isVideoOn;
  final String description;
  final Function(Map<String, dynamic>) onSendMessage;

  const ChatPanel({
    Key? key,
    required this.scenarioId,
    required this.botName,
    required this.email,
    required this.username,
    required this.title,
    required this.category,
    required this.difficulty,
    required this.mood,
    required this.startmessage,
    required this.isMicOn,
    required this.isVideoOn,
    required this.description,
    required this.onSendMessage,
  }) : super(key: key);

  @override
  State<ChatPanel> createState() => _ChatPanelState();
}

class _ChatPanelState extends State<ChatPanel> {
  final ScrollController _scrollController = ScrollController();
  AudioRecorder? audioRecorder;

  final WebSocketService webSocketService =
      WebSocketService(); // Use existing instance
  late List<Map<String, dynamic>> messages;
  final TextEditingController inputController = TextEditingController();
  final ChatViewModel _chatViewModel =
      ChatViewModel(chatRepository: ChatRepository(chatService: ChatService()));
  bool isChatInitialized = false;
  bool _isListening = false;
  bool _isAudioPlaying = false;
  Timer? _silenceTimer;
  String? username;
  String? email;
  String botResponseText = '';
  String accumulatedAudioBase64 = '';
  html.AudioElement? audioPlayer;
  bool isDownloadTriggered = false; // Flag to ensure download happens once
  final AudioPlayer _audioPlayer = AudioPlayer();
  List<int> accumulatedAudioBytes = [];
  html.File? audioFile;
  @override
  void initState() {
    super.initState();
    audioRecorder = AudioRecorder();

    final userViewModel = Provider.of<UserViewModel>(context, listen: false);
    userViewModel.loadUserInfo().then((_) {
      setState(() {
        username = userViewModel.userInfo?.name;
        email = userViewModel.userInfo?.professionalEmail;
      });

      if (email != null && email!.isNotEmpty) {
        _initializeChat();
      }
    });
    // Set the WebSocket listener for responses

    messages = [];

    js.context['dartGenerateMediaUrl'] = js.allowInterop((blob) {
      _processBlob(blob);
    });
  }

  void _initializeChat() async {
    try {
      final response = await _chatViewModel.getChatResponse(
          email: email ?? "",
          scenarioId: widget.scenarioId,
          userName: username ?? "",
          botName: widget.botName,
          delete: 'true');

      if (response.botResponse != null) {
        setState(() {
          messages.add({'isUser': false, 'text': response.botResponse});
        });
      } else if (response.chats != null && response.chats!.isNotEmpty) {
        setState(() {
          for (var chat in response.chats!) {
            bool isUser = chat.startsWith("${username}:");
            String displayText = isUser
                ? chat.replaceFirst("${username}:", "").trim()
                : chat.replaceFirst("${widget.botName}:", "").trim();

            messages.add({'isUser': isUser, 'text': displayText});
          }
        });
      }

      setState(() {
        isChatInitialized = true;
      });
      _scrollToBottom();

      if (widget.isMicOn == true && !_isAudioPlaying) {
        _startListening();
      }
    } catch (e) {
      print("Error fetching initial bot response: $e");
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _playAudioChunks(String base64AudioChunk) async {
    try {
      // Stop any ongoing playback
      if (_audioPlayer.playing) {
        print("Stopping ongoing audio playback...");
        await _audioPlayer.stop();
      }

      // Decode the Base64 string into bytes
      final Uint8List audioBytes = base64.decode(base64AudioChunk);

      // Use a custom StreamAudioSource
      final StreamAudioSource audioSource = MyStreamAudioSource(audioBytes);

      // Reset and load the new audio source
      await _resetAudioPlayer();
      await _audioPlayer.setAudioSource(audioSource);

      // Start playing
      await _audioPlayer.play();
      print("Audio playback started successfully.");
    } catch (e) {
      print("Error decoding or playing audio: $e");
    }
  }

  Future<Uint8List> _fetchBlobData(String blobUrl) async {
    try {
      final request = html.HttpRequest();
      request.open("GET", blobUrl, async: true);
      request.responseType = "arraybuffer"; // Fetch raw data
      request.send();

      await request.onLoadEnd.first;
      if (request.status == 200) {
        return Uint8List.view(request.response as ByteBuffer);
      } else {
        throw Exception("Failed to fetch blob: ${request.statusText}");
      }
    } catch (e) {
      throw Exception("Error fetching blob data: $e");
    }
  }

  void _startListening() {
    setState(() {
      _isListening = true;
    });

    try {
      // Clear previous input
      inputController.text = "";

      // Reinitialize JavaScript speech recognition callbacks
      js.context['onSpeechStart'] = js.allowInterop(() {
        setState(() {
          _isListening = true;
        });
      });

      js.context['onSpeechResult'] = js.allowInterop((String recognizedWords) {
        setState(() {
          inputController.text = recognizedWords;
        });
        _startSilenceDetection();
      });

      js.context['onSpeechError'] = js.allowInterop((String error) {
        print("Speech recognition error: $error");
        setState(() {
          _isListening = false;
        });
      });

      js.context['onSpeechEnd'] = js.allowInterop(() {
        setState(() {
          _isListening = false;
        });
      });
      setState(() => _isListening = true); // Update state to indicate listening
    } catch (e) {
      print("Error starting JavaScript speech recognition: $e");
    }

    _startSilenceDetection();
  }

  Future<void> _resetAudioPlayer() async {
    try {
      await _audioPlayer.stop(); // Stop playback
      await _audioPlayer.seek(Duration.zero); // Reset to the beginning
      // No need to setAudioSource(null)
      print("Audio player reset successfully.");
    } catch (e) {
      print("Error resetting audio player: $e");
    }
  }

  void _processBlob(html.Blob blob) {
    final reader = html.FileReader();
    reader.readAsDataUrl(blob);

    reader.onLoadEnd.listen((_) {
      final base64Audio = reader.result.toString().split(',')[1];
      print("Base64 Audio Received: ${base64Audio.length} bytes");

      final recognizedText = inputController.text.trim();
      if (recognizedText.isNotEmpty) {
        _sendMessage(base64Audio, recognizedText);
      } else {
        print("No recognized text to send.");
      }
    });

    reader.onError.listen((error) {
      print("Error reading Blob: $error");
    });
  }

  void _startSilenceDetection() {
    // Ensure this is properly starting the timer
    print("Starting silence detection timer...");
    _silenceTimer = Timer(const Duration(seconds: 6), () {
      print("Silence detected. Stopping recording...");
      _stopRecordingAndSend(); // Stop and send after 2 seconds
    });
  }

  void _stopRecordingAndSend() {
    if (!_isListening) {
      print("Not listening, returning early.");
      return;
    }

    js.context.callMethod('stopListening');
    setState(() {
      _isListening = false;
    });

    print("Calling stopRecording from JavaScript...");
    js.context.callMethod('stopRecording');

    // Add the event listener
    void eventListener(dynamic event) {
      html.window.removeEventListener(
          'dartGenerateMediaUrl', eventListener); // Clean up
      final blob = (event as html.CustomEvent).detail as html.Blob;
      _processBlob(blob);
    }

    html.window.addEventListener('dartGenerateMediaUrl', eventListener);
  }

  void getTips(String messageText) async {
    try {
      final messageResponse = await _chatViewModel.sendMessage(
        title: widget.title,
        category: widget.category,
        difficulty: widget.difficulty,
        description: widget.description,
        mood: widget.mood,
        botName: widget.botName,
        userName: username!,
        lastMessage: messageText,
        email: email!,
        scenarioId: widget.scenarioId,
        startMessage: widget.startmessage,
      );

      // Extract "Tip" and "emoji" from the response
      final tip = messageResponse['Tip'] ?? '';
      final emoji = messageResponse['emoji'] ?? '';

      // Combine them into a single response
      final botResponse = {
        'Tip': tip,
        'emoji': emoji,
      };

      // Pass the response to onSendMessage
      widget.onSendMessage(botResponse);
    } catch (e) {
      print("Error sending message: $e");
    }
  }

  Future<void> _sendMessageFile(html.File audioFile) async {
    try {
      final fileResponse = await _chatViewModel.sendMessageFile(
        title: widget.title,
        category: widget.category,
        difficulty: widget.difficulty,
        description: widget.description,
        mood: widget.mood,
        email: email!,
        scenarioId: widget.scenarioId,
        videoFile: audioFile, // Pass the recorded file
        isvideo: (widget.isMicOn && widget.isVideoOn) ? 'true' : 'false',
      );

      // Extract "Tip" and "emoji" from the response
      final audio = fileResponse['audio_emotion'] ?? '';
      final video = fileResponse['video_emotion'] ?? '';

      // Combine them into a single response
      final response = {
        'audio_emotion': audio,
        'video_emotion': video,
      };
      // Trigger callback with the response
      widget.onSendMessage(response);
    } catch (e) {
      print("Error sending file message: $e");
    }
  }

  Future<void> _sendMessage(String base64Audio, String input) async {
    print("sendMessage called ");
    print("Base64 Audio Length: ${base64Audio.length}");

    print("User input: $input");

    final userMessage =
        "User's speech-to-text result"; // Replace with STT result
    setState(() {
      messages.add({'isUser': true, 'text': input});
    });

    final payload = {
      'Title': widget.title,
      'Category': widget.category,
      'Difficulty': widget.difficulty,
      'Description': widget.description,
      'Mood': widget.mood,
      'bot_name': widget.botName,
      'user_name': username,
      'last_message': input,
      'email': widget.email,
      'scenario_id': widget.scenarioId,
      'start_message': widget.startmessage,
      'audio': base64Audio,
    };

    // Ensure listener is set before sending the message
    if (!webSocketService.isConnected) {
      print('WebSocket is not connected. Reconnecting...');
      webSocketService.connect(); // Ensure connection is established
    }

    try {
      // Send the payload via WebSocket.
      webSocketService.sendMessage(jsonEncode(payload));

      // Listen for response chunks.
      webSocketService.setResponseListener((textData) {
        String? textDelta = textData['delta'];
        if (textDelta != null && textDelta is String) {
          setState(() {
            if (messages.isEmpty || messages.last['isUser'] == true) {
              messages.add({'isUser': false, 'text': textDelta});
            } else {
              messages[messages.length - 1]['text'] += textDelta;
            }
            _scrollToBottom();
          });
        }
      }, (audioData) {
        // Process audio data when it is received directly
        if (audioData != null && audioData is String) {
          // audioData is the base64 string
          final String base64String = audioData;
          handleAudioData(audioData);
          // _playAudioChunks(reencodedBase64);
        } else {
          print("Error: Audio data is not a valid base64 string");
        }
      }, (done) {
        // Trigger download after all audio chunks are received
        print("All audio chunks received, starting download...");
        // _downloadAudio();
      });
      getTips("hello");
      final audioFile = await createAudioFileFromBase64(base64Audio);
      await _sendMessageFile(audioFile);
    } catch (e) {
      print('Error sending message via WebSocket: $e');
    }
  }

  Future<html.File> createAudioFileFromBase64(String base64AudioData) async {
    try {
      // Convert the base64 string back to bytes
      final audioBytes = base64.decode(base64AudioData);

      // Create a Blob from the audio bytes
      final mimeType =
          'audio/wav'; // Ensure this is the correct MIME type for your audio
      final blob = html.Blob([Uint8List.fromList(audioBytes)], mimeType);

      // Create and return a File
      return html.File([blob], 'audio_output.wav', {'type': mimeType});
    } catch (e) {
      print("Error creating audio file: $e");
      rethrow; // To handle errors gracefully
    }
  }

  void handleAudioData(String base64AudioData) {
    try {
      // Decode the Base64 string into raw bytes
      final List<int> audioBytes = base64.decode(base64AudioData);

      // Validate Base64 encoding (optional, can be used for debugging)
      final reencodedBase64 = base64.encode(audioBytes);
      if (reencodedBase64 != base64AudioData) {
        throw Exception("Base64 validation failed. Encoded data mismatch.");
      }

      // Add the received audio bytes to the accumulated chunks list
      accumulatedAudioBytes.addAll(audioBytes);
      print("Received audio chunk: ${audioBytes.length} bytes");

      // Now we can trigger the download of the audio data when all chunks are received
      if (!isDownloadTriggered) {
        print("All audio chunks received, starting download...");
        isDownloadTriggered = true; // Mark download as triggered

        // Convert the accumulated bytes into a single Blob
        final blob =
            html.Blob([Uint8List.fromList(accumulatedAudioBytes)], 'audio/wav');

        // Create a URL for the Blob
        final url = html.Url.createObjectUrlFromBlob(blob);

        // Create an anchor tag for the download link
        final anchor = html.AnchorElement(href: url)
          ..target = 'blank'
          ..download = 'audio_output.wav' // Set the file name for download
          ..click(); // Trigger the download

        // Cleanup the object URL after download
        html.Url.revokeObjectUrl(url);

        print("Audio download triggered successfully.");
      }
    } catch (e) {
      print("Error handling audio data: $e");
    }
  }

  void _downloadAudio(String base64AudioData) {
    try {
      // Convert the base64 string back to bytes
      final audioBytes = base64.decode(base64AudioData);

      // Create a Blob from the audio bytes
      final mimeType =
          'audio/wav'; // Ensure this is the correct MIME type for your audio
      final blob = html.Blob([Uint8List.fromList(audioBytes)], mimeType);

      // Create a URL for the Blob
      final url = html.Url.createObjectUrlFromBlob(blob);

      // Create an anchor tag for the download link
      final anchor = html.AnchorElement(href: url)
        ..target = 'blank'
        ..download =
            'audio_output.wav' // Change the name or extension if needed
        ..click(); // Trigger the download

      // Cleanup the object URL after download
      html.Url.revokeObjectUrl(url);

      print("Audio download triggered successfully.");
    } catch (e) {
      print("Error during audio download: $e");
    }
  }

  @override
  void dispose() {
    _silenceTimer?.cancel();
    _audioPlayer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height / 1.1,
      margin: const EdgeInsets.all(8.0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15.0),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withOpacity(0.2),
            spreadRadius: 1,
            blurRadius: 6,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                itemCount: messages.length,
                itemBuilder: (context, index) {
                  final message = messages[index];
                  final isUser = message['isUser'] as bool;

                  return Row(
                    mainAxisAlignment: isUser
                        ? MainAxisAlignment.end
                        : MainAxisAlignment.start,
                    children: [
                      if (!isUser)
                        CircleAvatar(
                          backgroundImage:
                              AssetImage("assets/images/avatar-manager.jpg"),
                        ),
                      SizedBox(width: 8),
                      Column(
                        children: [
                          Container(
                            padding: EdgeInsets.all(10),
                            constraints: BoxConstraints(maxWidth: 250),
                            decoration: BoxDecoration(
                              color: isUser ? Colors.blue : Colors.grey[200],
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              message['text'],
                              style: TextStyle(
                                  color: isUser ? Colors.white : Colors.black),
                            ),
                          ),
                          SizedBox(
                            height: 10,
                          ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
            if (widget.isMicOn)
              if (_isListening)
                Align(
                  alignment: Alignment.bottomRight,
                  child: AnimatedWaveform(
                    barWidth: 2.0,
                    barCount: 20,
                    color: Colors.blueAccent,
                    isListening: _isListening,
                  ),
                )
              else
                // Placeholder for when the mic is on but not actively listening
                SizedBox.shrink()
            else
              // Message when the mic is off
              Align(
                alignment: Alignment.bottomRight,
                child: Container(
                  padding: const EdgeInsets.all(8.0),
                  margin: const EdgeInsets.only(top: 8.0),
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    "Turn on your mic to speak",
                    style: TextStyle(
                      color: Colors.black54,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            if (_isAudioPlaying)
              Align(
                alignment: Alignment.bottomLeft,
                child: LoadingAnimationWidget.waveDots(
                  color: Colors.blueAccent,
                  size: 50,
                ),
              )
          ],
        ),
      ),
    );
  }
}

class MyStreamAudioSource extends StreamAudioSource {
  final Uint8List _audioBytes;

  MyStreamAudioSource(this._audioBytes);

  @override
  Future<StreamAudioResponse> request([int? start, int? end]) async {
    start ??= 0;
    end ??= _audioBytes.length;
    return StreamAudioResponse(
      sourceLength: _audioBytes.length,
      contentLength: end - start,
      offset: start,
      stream: Stream.value(_audioBytes.sublist(start, end)),
      contentType:
          'audio/mpeg', // Update to 'audio/wav' or other format if needed
    );
  }
}

class TipsContainer extends StatelessWidget {
  final Map<String, dynamic>? response;

  TipsContainer({this.response});

  @override
  Widget build(BuildContext context) {
    if (response == null) {
      return SizedBox.shrink();
    }

    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: 50, minWidth: 100),
      child: Container(
        height: 150,
        padding: EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.blue[50],
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              response?['Tip'] ?? '',
              style: TextStyle(
                fontSize: 14,
              ),
            ),
            SizedBox(
              height: 5,
            ),
            Text(
              response?['emoji'] ?? '',
              style: TextStyle(fontSize: 14, color: Colors.deepOrange),
            ),
            SizedBox(
              height: 5,
            ),
            // Highlighted audio_emotion in a container with yellow background
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.yellow.shade200, // Background color for highlight
                borderRadius: BorderRadius.circular(4), // Rounded corners
              ),
              child: Text(
                response?['audio_emotion'] ?? 'hello hii',
                style: TextStyle(fontSize: 14, color: Colors.black),
              ),
            ),
            SizedBox(
              height: 5,
            ),
            // Highlighted video_emotion in a container with yellow background
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.yellow, // Background color for highlight
                borderRadius: BorderRadius.circular(4), // Rounded corners
              ),
              child: Text(
                response?['video_emotion'] ?? '',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold, // Optional: make it bold
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
