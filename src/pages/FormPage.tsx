import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
} from 'react-icons/fa'; // Importing icons
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import TimerComponent from '../components/timer/TimerComponent';
import imagess from '../assests/imgds.jpg';
import data from '../data/data';
import WavEncoder from 'wav-encoder'; // Import wav-encoder
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { Link } from 'react-router-dom';
import DeleteModel from '../components/delete/DeleteModel';

const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

function ScenarioForm() {
  const [isRecording, setIsRecording] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [base64Media, setBase64Media] = useState<string | null>(null); // Base64 format for audio and video
  const [isMicOn, setIsMicOn] = useState(true); // State for microphone
  const [isCameraOn, setIsCameraOn] = useState(true); // State for camera
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]); // Store chunks of video and audio
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [items, setItems] = useState<ItemType[]>([]);
  const [chats, setChats] = useState<any[]>([]); // Assuming chats is an array
  const [botChat, setBotChat] = useState<any>(null); // Assuming chats is an array
  const [text, setText] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [wavUrl, setWavUrl] = useState<any | null>(null);
  const [getTips, setgetTips] = useState<any | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const startTimeRef = useRef<string>(new Date().toISOString());

  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US'; // Set the language
  recognition.interimResults = false; // Only return final results
  recognition.continuous = false; // Listen for a single phrase

  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );

  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        // console.log('### audiodelta: ', delta.audio);
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  useEffect(() => {
    startAudioVideoProcessing();
    return () => {
      // Clean up resources on unmount
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    console.log('@@@ IS RECORDING: ', isRecording);
  }, [isRecording]);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    //  Check if already connected
    if (isConnected) {
      console.warn('Already connected. Disconnecting first...');
      try {
        await wavRecorder.end(); // End previous recording
      } catch (endError) {
        console.error('Error ending previous recording:', endError);
      }
    }

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // await wavRecorder.begin();
    // // Connect to audio output
    // await wavStreamPlayer.connect();
    // if (client.getTurnDetectionType() === 'server_vad') {
    //   await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    // }

    try {
      // Connect to microphone
      await wavRecorder.begin();
      // Connect to audio output
      await wavStreamPlayer.connect();
      if (client.getTurnDetectionType() === 'server_vad') {
        await wavRecorder.record((data) => client.appendInputAudio(data.mono));
      }
    } catch (error) {
      console.error('connectConversation error:', error);
      // Ensure proper cleanup on error
      setIsConnected(false);
      try {
        await wavRecorder.end();
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
  }, []);

  // Call the function when the component loads
  useEffect(() => {
    connectConversation();
  }, []);

  const startAudioVideoProcessing = async () => {
    try {
      const client = clientRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        // video: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048; // Configure the analyser
      const dataArray = new Uint8Array(analyserRef.current.fftSize);

      source.connect(analyserRef.current);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mediaBlob = new Blob(mediaChunksRef.current, {
          // type: 'video/webm',
          type: 'audio/webm',
        });
        const mediaUrl = URL.createObjectURL(mediaBlob);
        setMediaUrl(mediaUrl);

        //     // Trigger download
        //     const anchor = document.createElement('a');
        //     anchor.href = mediaUrl;
        // const abc=    anchor.download = 'audio.mp3';
        // console.log(abc,"abc")
        //     document.body.appendChild(anchor);
        //     anchor.click();
        //     document.body.removeChild(anchor);

        // Convert to WAV
        const wavBlob = await convertToWav(mediaBlob);
        const wavBlobUrl = URL.createObjectURL(wavBlob);
        setWavUrl(wavBlobUrl);

        convertToBase64(mediaBlob); // Convert to base64 for both audio and video
        mediaChunksRef.current = [];
      };

      mediaRecorderRef.current = mediaRecorder;

      monitorAudioLevels(dataArray, stream);

      // Check connection status before connecting
      if (client.isConnected()) {
        console.log('Client already connected. Skipping connect()..');
      } else {
        console.log('Client not connected. Establishing connection...');
        await client.connect();
      }
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const convertToWav = async (audioBlob: Blob): Promise<Blob> => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();

    // Decode audio data
    const decodedData = await audioContext.decodeAudioData(arrayBuffer);

    // Prepare WAV encoding
    const wavData = {
      sampleRate: decodedData.sampleRate,
      channelData: Array.from(
        { length: decodedData.numberOfChannels },
        (_, i) => decodedData.getChannelData(i)
      ),
    };

    // Encode WAV
    const wavArrayBuffer = await WavEncoder.encode(wavData);
    return new Blob([wavArrayBuffer], { type: 'audio/wav' });
  };

  const monitorAudioLevels = (dataArray: Uint8Array, stream: MediaStream) => {
    const detectSpeech = () => {
      analyserRef.current?.getByteTimeDomainData(dataArray);

      // Calculate RMS value (volume level)
      const rms = Math.sqrt(
        dataArray.reduce((sum, value) => sum + Math.pow(value - 128, 2), 0) /
          dataArray.length
      );

      const threshold = 20; // Audio sensitivity threshold
      if (rms > threshold) {
        if (!isRecording) {
          startRecording();
        }

        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        silenceTimeoutRef.current = window.setTimeout(stopRecording, 2000); // Stop after 2 seconds of silence
      }

      requestAnimationFrame(detectSpeech);
    };

    detectSpeech();
  };

  const startRecording = async () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'recording'
    ) {
      // stopListening();
      mediaRecorderRef.current.start();
      setIsRecording(true);
      console.log('Recording started...: ', recognition);
      // await recognition.stop();
      startListening();
    } else {
      console.warn('MediaRecorder is already recording.');
      // await recognition.stop();
      // startListening()
    }
  };

  const startListening = useCallback(async () => {
    // console.log('start1')
    // if (isListening) {
    //   console.warn("SpeechRecognition is already listening.");
    //   return; // Prevent starting recognition if already active
    // }

    try {
      if (recognition) {
        await recognition.start();
        // setIsListening(true);

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          console.log('SpeechRecognition event:', event);
          const transcript = event.results[0][0].transcript;
          console.log('Transcript::', transcript);
          setText(transcript);
        };

        recognition.onspeechend = () => {
          console.log('Speech ended');
          // setIsListening(false);
          recognition.stop();
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event?.error);
          // setIsListening(false);
        };
      } else {
        console.warn('Recognition is already started or in an invalid state.');
        console.log('start3');
      }
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      console.log('start4');
    }
  }, [text]);

  // console.log(text, "text--------")

  const stopListening = () => {
    // setIsListening(false);
    recognition.stop();
  };

  const stopRecording = () => {
    stopListening();
    const client = clientRef.current;
    if (isListening) {
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      const title = 'Example Title'; // Replace with dynamic value
      const category = 'Example Category'; // Replace with dynamic value
      const difficulty = 'Medium'; // Replace with dynamic value
      const description = 'This is a sample scenario.'; // Replace with dynamic value
      const mood = 'Friendly'; // Replace with dynamic value
      const user_name = 'User'; // Replace with dynamic value
      const previous_msg = 'This is a sample scenario'; // Replace with dynamic value

      const prompt = `
      Your task is to reply to the user based on previous chats, current user response, and the scenario with the following details:
      Title: ${title}, 
      Category: ${category}, 
      Difficulty: ${difficulty},
      Description: ${description},
      Mood: ${mood}.

      previous messages:
      ${previous_msg} // A function to fetch prior messages

      current message:
      Hello!

      If the last message is out of scenario context and not part of the scenario, create a dialog telling the user to get back to the current scenario. Do not respond to out-of-context messages.
      Name of the user is ${user_name}.

      Keep the conversation natural like a real person is talking.
      Return a single dialog.

      dialog
    `;
      // client.sendUserMessageContent([
      //   {
      //     type: 'input_text',
      //     text: prompt,
      //   },
      // ]);
      client.createResponse();
      console.log('Recording stopped...');
    } else {
      console.warn('MediaRecorder is not recording.');
    }
  };

  const convertToBase64 = (blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setBase64Media(base64String);
    };
    reader.readAsDataURL(blob); // Convert to base64
  };

  const toggleMicrophone = () => {
    console.log('@@@ MIC: ', streamRef.current);
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  // Toggle the camera on/off
  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  // ---------------------

  const fetchChatApiSecondTime = async () => {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
    };

    try {
      const response = await fetch(
        'https://socialiq.zapto.org/show_chat?email=developer.wellorgs@gmail.com&scenario_id=67287f19933445b37471fe79&user_name=testuser&bot_name=Kevin',
        requestOptions
      );
      const result = await response.json();

      if (result.bot_response) {
        setBotChat(result);
      } else if (result.chats && result.chats.length > 0) {
        setChats((prevChats) => [...prevChats, ...result.chats]);
      }
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  };

  useEffect(() => {
    fetchChatApiSecondTime();
  }, []);

  useEffect(() => {
    console.log(text, 'texttext');
  }, [text]);

  const fetchGetTips = async () => {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
    };

    try {
      const response = await fetch(
        `https://socialiq.zapto.org/get_tips?email=developer.wellorgs@gmail.com&scenario_id=67287c99933445b37471fe71&Title=Code Review Clash&Category=Conflict Resolution&Difficulty=Intermediate&Description=A tense conversation between a junior developer, User, and a senior developer, Jamie, over feedback on a code review.&Mood= Supportive&user_name= Jamie&last_message=hello`,
        requestOptions
      );
      const result = await response.json();
      if (result) {
        setgetTips(result);
      }
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  };

  useEffect(() => {
    fetchGetTips();
  }, []);

  const DeleteChatStatus = () => {
    const formdata = new FormData();
    formdata.append('email', 'developer.wellorgs@gmail.com');
    formdata.append('scenario_id', '67287e26933445b37471fe76');

    const requestOptions: RequestInit = {
      method: 'POST',
      body: formdata,
      redirect: 'follow',
    };

    fetch('https://socialiq.zapto.org/delete_chat_status', requestOptions)
      .then((response) => response.json())
      .then((result) => {
        if (result) {
          if (result.message == 'Added Delete status to the chat') {
            setIsOpen(false);
          }
        }
      })
      .catch((error) => console.error(error));
  };
  return (
    <>
      <section className="bg-[#e6e6e6] h-full  mx-auto p-5 sm:p-10 md:px-6 py-5  ">
        <div className="container mx-auto">
          <div className="flex  justify-between items-center mb-3  ">
            <p className="text-center text-[#1c4f78] ">
              <a href="/" title="home">
                Dashboard &gt;{' '}
              </a>
              <a href="/aboutus" title="about">
                Salary Negotation Success &gt;{' '}
              </a>
              <a href="/aboutus" title="about">
                Real Time Interaction{' '}
              </a>
            </p>

            <div className="flex items-center gap-5">
              <div>Time : 00: 00 : 00</div>
            </div>

            <div className="flex flex-col items-center justify-center gap-5  md:flex-row py-3">
              <Link
                className="inline-block w-auto text-center  px-6 py-1 text-white transition-all rounded-md shadow-xl sm:w-auto bg-[#5c9bb6] hover:shadow-2xl hover:shadow-blue-400 hover:-tranneutral-y-px "
                to="#"
                onClick={() => setIsOpen(true)}
              >
                Exit
              </Link>
              <a
                className="inline-block w-auto text-center min-w-[200px] px-3 py-1 text-white transition-all bg-gray-700 dark:bg-[#ff5252] dark:text-white rounded-md shadow-xl sm:w-auto  hover:text-white shadow-neutral-300  hover:shadow-2xl hover:shadow-neutral-400 hover:-tranneutral-y-px"
                href=""
              >
                End The Session
              </a>
            </div>
            <DeleteModel
              open={isOpen}
              setOpen={setIsOpen}
              DeleteChatStatus={DeleteChatStatus}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
          <div className="sm:col-span-6 lg:col-span-6   ">
            <div className="flex gap-5">
              <img
                src={imagess}
                className="rounded-2xl w-1/2 h-80 object-cover "
                style={{ borderWidth: 0, borderColor: 'blue' }}
              />
              <div>
                {/* Webcam feed display */}
                <div style={{ position: 'relative' }}>
                  {/* <h2>Webcam Feed</h2> */}
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    width="300"
                    height="400"
                    className="border w-full h-80 shadow-md"
                    style={{ borderRadius: '16px' }}
                  ></video>

                  {/* Mic and Camera control buttons */}
                  <div className="flex justify-center items-center gap-5 absolute bottom-0 inset-x-0">
                    <div>
                      <button
                        onClick={toggleMicrophone}
                        style={{ background: 'transparent', border: 'none' }}
                      >
                        {isMicOn ? (
                          <FaMicrophone size={20} color="white" />
                        ) : (
                          <FaMicrophoneSlash size={20} color="white" />
                        )}
                      </button>
                    </div>
                    <div>
                      <button
                        onClick={toggleCamera}
                        style={{ background: 'transparent', border: 'none' }}
                      >
                        {isCameraOn ? (
                          <FaVideo size={20} color="white" />
                        ) : (
                          <FaVideoSlash size={20} color="white" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end  mt-5">
              <div className=" bg-[#e3f2fd] w-80  rounded-2xl p-5">
                <span>{getTips !== null && getTips.Tip}</span>
                <span className="block">
                  {getTips !== null && getTips.emoji}
                </span>
              </div>
            </div>
            {text && (
              <div>
                <h2>Base64 Audio & Video</h2>
                {/* <textarea
                    readOnly
                    rows={10}
                    cols={50}
                    value={text}
                  ></textarea> */}
              </div>
            )}
          </div>

          <div className="max-w-2xl flex justify-center sm:col-span-6 lg:col-span-6">
            <div className="bg-white w-[900px] h-[86vh]  overflow-y-scroll   pb-10 border border-1 border-zinc-300 border-opacity-30 rounded-2xl relative overflow-hidden p-5">
              <div className="flex flex-col w-full gap-3">
                {botChat ? (
                  <>
                    <div className="flex justify-start gap-1">
                      <img
                        src={
                          botChat.avatarUrl ||
                          'https://www.tailwind-kit.com/images/object/10.png'
                        }
                        className="h-12 w-12 border border-[1px] border-zinc-300 border-opacity-50 rounded-full ml-3 opacity-90 "
                      />
                      <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-center px-2 py-2 text-white relative">
                        {botChat.bot_response}
                      </div>
                    </div>

                    <div className="mt-2 ">
                      <audio autoPlay>
                        <source src={botChat?.audio_url} type="audio/mp3" />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  </>
                ) : chats.length > 0 ? (
                  chats.map((message, index) => {
                    const isTestUserMessage = message.startsWith('testuser:');
                    return (
                      <div
                        key={index}
                        className={`flex ${
                          isTestUserMessage ? 'justify-end' : 'justify-start'
                        } items-center`}
                      >
                        {isTestUserMessage ? (
                          <>
                            <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-center px-2 py-2 text-white relative">
                              {message}
                            </div>
                            <img
                              src={
                                message.avatarUrl ||
                                'https://www.tailwind-kit.com/images/object/10.png'
                              }
                              className="h-12 w-12 border border-[1px] border-zinc-300 border-opacity-50 rounded-full ml-3 opacity-90 pl-[1px]"
                            />
                          </>
                        ) : (
                          <>
                            <img
                              src={
                                message.avatarUrl ||
                                'https://www.tailwind-kit.com/images/object/10.png'
                              }
                              className="h-12 w-12 border border-[1px] border-zinc-300 border-opacity-50 rounded-full mr-3 opacity-90"
                              alt="User avatar"
                            />
                            <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative">
                              {message}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div>Loading chats.............</div> // In case there's no response or chat
                )}
              </div>
              {items.map((conversationItem, i) => {
                return (
                  <div className="" key={conversationItem.id}>
                    <div className={``}>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}

                      {/* {!conversationItem.formatted.tool &&
                          conversationItem.role === 'user' && (
                            <div>
                              {conversationItem.formatted.transcript ||
                                (conversationItem.formatted.audio?.length
                                  ? '(awaiting transcript)'
                                  : conversationItem.formatted.text ||
                                    '(item sent)')}
                            </div>
                         )} */}

                      <div className="flex mb-4 justify-end gap-1 ">
                        <img
                          src={
                            'https://www.tailwind-kit.com/images/object/10.png'
                          }
                          className="h-12 w-12 border border-[1px] border-zinc-300 border-opacity-50 rounded-full ml-3 opacity-90 pl-[1px]"
                        />
                        <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative">
                          {/* {conversationItem.formatted.transcript ||
                                  conversationItem.formatted.text ||
                                  '(truncated)'} */}

                          {text}
                        </div>
                      </div>

                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div className="flex mb-4 justify-start gap-1">
                            <img
                              src={
                                'https://www.tailwind-kit.com/images/object/10.png'
                              }
                              className="h-12 w-12 border border-[1px] border-zinc-300 border-opacity-50 rounded-full ml-3 opacity-90 pl-[1px]"
                            />
                            <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-center px-2 py-2 text-white relative">
                              {conversationItem.formatted.transcript ||
                                conversationItem.formatted.text ||
                                '(truncated)'}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default ScenarioForm;
