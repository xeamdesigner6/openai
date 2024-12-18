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
import { toast } from 'react-toastify';
import { log } from 'console';

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
  const [isRecordingStop, setIsRecordingStop] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [base64Media, setBase64Media] = useState<string | null>(null); // Base64 format for audio and video
  const [isMicOn, setIsMicOn] = useState(true); // State for microphone
  const [isCameraOn, setIsCameraOn] = useState(true); // State for camera
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]); // Store chunks of video and audio
  const videoChunksRef = useRef<Blob[]>([]); // Store chunks of video and audio
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
  const [wavBlobUrl, setWavBlobUrl] = useState<any | null>(null);
  const [getTips, setgetTips] = useState<any | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const startTimeRef = useRef<string>(new Date().toISOString());
  const [timeData, setTimeData] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  }>({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [time, setTime] = useState<string>('');
  const [timeUpdated, setTimeUpdated] = useState<boolean>(false);

  const [includeVideo, setIncludeVideo] = useState(false);
  const mediaStreamRef = useRef(null);

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
  }, [isCameraOn]);

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

    try {
      // Connect to microphone
      await wavRecorder.begin();
      if (wavRecorder.getStatus() === 'recording') {
        await wavRecorder.pause();
      }
      // Connect to audio output
      await wavStreamPlayer.connect();

      await wavRecorder.record((data) => {
        client.appendInputAudio(data.mono);
      });
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
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: isCameraOn ? { facingMode: 'user' } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (isCameraOn && videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play(); // Ensure the video plays
      }
      const mimeType = isCameraOn ? 'video/webm;codecs=vp8' : 'audio/webm';
      const bitsPerSecond = isCameraOn ? 256000 : 64000; // Lower bitrate for mobile
      const options = { mimeType, bitsPerSecond };

      // Set up the audio context
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      const dataArray = new Uint8Array(analyserRef.current.fftSize);
      source.connect(analyserRef.current);

      // Set up MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      videoChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
      console.log(mimeType, '===type of mime');
      mediaRecorder.onstop = async () => {
        const mediaBlob = new Blob(videoChunksRef.current, { type: mimeType });
        const mediaUrl = URL.createObjectURL(mediaBlob);
        setMediaUrl(mediaUrl);
        console.log('Recording complete. Video Blob URL:', mediaUrl);
        if (!isCameraOn) {
          // Convert to WAV if needed
          const wavBlob = await convertToWav(mediaBlob);
          const wavBlobUrl = URL.createObjectURL(wavBlob);
          setWavUrl(wavBlobUrl);
          setWavBlobUrl(wavBlob);

          // Cleanup the object URL after the download
          URL.revokeObjectURL(wavBlobUrl);

          // Optional: You can use this for base64 conversion or any other processing
          convertToBase64(mediaBlob);
        }

        videoChunksRef.current = [];
      };

      mediaRecorder.start();
      setIsRecording(true);
      console.log('Recording started...');

      // Monitor audio levels
      monitorAudioLevels(dataArray, stream);

      // Client connection logic (Placeholder)
      const client = clientRef.current;
      if (client && client.isConnected()) {
        console.log('Client already connected. Skipping connect()..');
      } else {
        console.log('Client not connected. Establishing connection...');
        await client.connect();
      }

      const wavRecorder = wavRecorderRef.current;
      if (wavRecorder) {
        await wavRecorder.record((data: any) => {
          if (client) {
            client.appendInputAudio(data.mono);
          }
        });
      }
    } catch (error) {
      console.error('Error accessing microphone or camera:', error);
    }
  };

  // const startAudioVideoProcessing = async () => {
  //   try {
  //     const client = clientRef.current;
  //     const wavRecorder = wavRecorderRef.current;
  //     const constraints: MediaStreamConstraints = {
  //       audio: true,
  //       video: includeVideo ? { facingMode: 'user' } : false,
  //     };
  //     // const stream = await navigator.mediaDevices.getUserMedia({
  //     //   audio: true,
  //     //   video: true,
  //     // });
  //     const stream = await navigator.mediaDevices.getUserMedia(constraints);
  //     streamRef.current = stream;

  //     const mimeType = includeVideo ? 'video/webm;codecs=vp8' : 'audio/webm';
  //     const bitsPerSecond = includeVideo ? 256000 : 64000; // Lower bitrate for mobile
  //     const options = { mimeType, bitsPerSecond };

  //     // if (videoRef.current) {
  //     //   videoRef.current.srcObject = stream;
  //     // }
  //     audioContextRef.current = new AudioContext({ sampleRate: 24000 });
  //     const source = audioContextRef.current.createMediaStreamSource(stream);

  //     analyserRef.current = audioContextRef.current.createAnalyser();
  //     analyserRef.current.fftSize = 2048; // Configure the analyser
  //     const dataArray = new Uint8Array(analyserRef.current.fftSize);

  //     source.connect(analyserRef.current);

  //     const mediaRecorder = new MediaRecorder(stream, options);
  //     mediaRecorderRef.current = mediaRecorder;
  //     videoChunksRef.current = [];

  // mediaRecorder.ondataavailable = (event) => {
  //   if (event.data.size > 0) {
  //     mediaChunksRef.current.push(event.data);
  //     // console.log(event.data,"121212")
  //   }
  // };

  //     mediaRecorder.onstop = async () => {
  //       // const mediaBlob = new Blob(mediaChunksRef.current, {
  //       //   // type: 'video/webm',
  //       //   type: 'audio/webm',
  //       // });
  //       const mediaBlob = new Blob(videoChunksRef.current, { type: mimeType });

  //       const mediaUrl = URL.createObjectURL(mediaBlob);
  //       setMediaUrl(mediaUrl);

  //       console.log('Recording complete. Video Blob URL:', mediaUrl);

  //       // Convert to WAV
  //       const wavBlob = await convertToWav(mediaBlob);
  //       const wavBlobUrl = URL.createObjectURL(wavBlob);
  //       setWavUrl(wavBlobUrl);
  //       setWavBlobUrl(wavBlob);

  //       // Create a temporary anchor element to trigger the download
  //       // const anchor = document.createElement('a');
  //       // anchor.href = wavBlobUrl;
  //       // anchor.target = '_blank';
  //       // anchor.download = 'audio_output.wav';
  //       // anchor.click(); // Trigger the download

  //       // Cleanup the object URL after the download
  //       URL.revokeObjectURL(wavBlobUrl);

  //       convertToBase64(mediaBlob);
  //       mediaChunksRef.current = [];
  //     };

  //     mediaRecorderRef.current = mediaRecorder;

  //     monitorAudioLevels(dataArray, stream);

  //     // Check connection status before connecting
  //     if (client.isConnected()) {
  //       console.log('Client already connected. Skipping connect()..');
  //     } else {
  //       console.log('Client not connected. Establishing connection...');
  //       await client.connect();
  //     }
  //     await wavRecorder.record((data) => {
  //       client.appendInputAudio(data.mono);
  //     });
  //   } catch (error) {
  //     console.error('Error accessing microphone:', error);
  //   }
  // };

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
    const wavRecorder = wavRecorderRef.current;
    const client = clientRef.current;
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
    if (wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    await wavRecorder.record((data) => {
      client.appendInputAudio(data.mono);
    });
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

  const stopListening = async () => {
    // setIsListening(false);
    await recognition.stop();
  };

  const stopRecording = async () => {
    stopListening();
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsRecordingStop(true);
      await wavRecorder.pause();
      client.createResponse();
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
  useEffect(() => {
    console.log('Toggling camera...');

    if (!streamRef.current) {
      console.error('streamRef.current is null or undefined.');
      return;
    }

    const videoTracks = streamRef.current.getVideoTracks();
    if (videoTracks.length === 0) {
      console.error('No video tracks found in the stream.');
      return;
    }

    const videoTrack = videoTracks[0];
    videoTrack.enabled = !videoTrack.enabled;
    console.log(`Camera toggled: ${videoTrack.enabled}`);
  }, [isCameraOn]);
  // Toggle the camera on/off
  // const toggleCamera = () => {
  //   console.log('Toggling camera...');

  //   if (!streamRef.current) {
  //     console.error('streamRef.current is null or undefined.');
  //     return;
  //   }

  //   const videoTracks = streamRef.current.getVideoTracks();
  //   if (videoTracks.length === 0) {
  //     console.error('No video tracks found in the stream.');
  //     return;
  //   }

  //   const videoTrack = videoTracks[0];
  //   videoTrack.enabled = !videoTrack.enabled;
  //   console.log(`Camera toggled: ${videoTrack.enabled}`);

  //   setIsCameraOn(!isCameraOn);
  // };
  // const toggleCamera = () => {
  //   if (streamRef.current) {
  //     const videoTrack = streamRef.current.getVideoTracks()[0];
  //     if (videoTrack) {
  //       videoTrack.enabled = !videoTrack.enabled;
  //       setIsCameraOn(videoTrack.enabled);
  //     }
  //   }
  // };

  // ---------------------

  const fetchChatApiSecondTime = async () => {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
    };

    try {
      // const response = await fetch(
      //   'https://socialiq.zapto.org/show_chat?email=developer.wellorgs@gmail.com&scenario_id=67287e26933445b37471fe76&user_name=testuser&bot_name=Kevin',
      //   requestOptions
      // );
      const response = await fetch(
        'https://socialiq.zapto.org/show_chat?email=developer.wellorgs@gmail.com&scenario_id=67287cf2933445b37471fe72&user_name=testuser&bot_name=Kevin',
        requestOptions
      );
      const result = await response.json();
      if (result.bot_response) {
        setBotChat(result);
      } else if (result.time && result.chats.length > 0) {
        setChats((prevChats) => [...prevChats, ...result.chats]);
        setTime(result.time);
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

  const addTimeChats = () => {
    const { hours, minutes, seconds } = timeData;
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const formdata = new FormData();
    formdata.append('email', 'developer.wellorgs@gmail.com');
    formdata.append('scenario_id', '67287c99933445b37471fe71');
    formdata.append('time', formattedTime);

    const requestOptions: RequestInit = {
      method: 'POST',
      body: formdata,
      redirect: 'follow',
    };

    fetch('https://socialiq.zapto.org/add_time', requestOptions)
      .then((response) => response.json())
      .then((result) => {
        toast.success(result.message);
        setTimeUpdated(true);
        if (result) {
          const formdata = new FormData();
          formdata.append('email', 'developer.wellorgs@gmail.com');
          formdata.append('scenario_id', '67287c99933445b37471fe71');
          formdata.append('Title', 'Code Review Clash');
          formdata.append('Category', 'Conflict Resolution');
          formdata.append('Difficulty', 'Intermediate');
          formdata.append(
            'Description',
            'A tense conversation between a junior developer, User, and a senior developer, Jamie, over feedback on a code review.'
          );
          formdata.append('Mood', 'Supportive');
          formdata.append('user_name', 'hello');
          formdata.append('bot_name', 'hello');

          const requestOptions: RequestInit = {
            method: 'POST',
            body: formdata,
            redirect: 'follow',
          };

          fetch('https://socialiq.zapto.org/scenario_analysis', requestOptions)
            .then((response) => response.json())
            .then((result) => {
              setTimeout(() => {
                toast.success(result.Message);
              }, 5000);
            })
            .catch((error) => console.error(error));
        }
      })

      .catch((error) => console.error(error));
  };

  const fetchGetTips = async () => {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
    };

    try {
      const response = await fetch(
        `https://socialiq.zapto.org/get_tips?email=developer.wellorgs@gmail.com&scenario_id=67287c99933445b37471fe71&Title=Code Review Clash&Category=Conflict Resolution&Difficulty=Intermediate&Description=A tense conversation between a junior developer, User, and a senior developer, Jamie, over feedback on a code review.&Mood= Supportive&user_name= Jamie&last_message=${text}`,
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

  const fetchStoreDetails = async () => {
    const myHeaders = new Headers();
    myHeaders.append('Content-Type', 'application/json');

    const raw = JSON.stringify({
      email: 'developer.wellorgs@gmail.com',
      Title: 'Code Review Clash',
      Category: 'Conflict Resolution',
      Difficulty: 'Intermediate',
      Description:
        'A tense conversation between a junior developer, User, and a senior developer, Jamie, over feedback on a code review.',
      Mood: 'Supportive',
      scenario_id: '67287c99933445b37471fe71',
      bot_name: 'hello',
      user_name: 'abc',
      start_message: 'Hello testuser',
      last_message: 'Let’s make this',
    });

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow',
    };

    fetch('https://socialiq.zapto.org/store_details', requestOptions)
      .then((response) => response.json())
      .then((result) => {
        console.log(result.message);
        toast.success(result.message);
      })
      .catch((error) => console.error(error));
  };

  const fetchGenerateDialogVideo = () => {
    const formdata = new FormData();
    formdata.append('email', 'developer.wellorgs@gmail.com');
    formdata.append('scenario_id', '67287c99933445b37471fe71');
    formdata.append('Title', 'Code Review Clash');
    formdata.append('Category', 'Conflict Resolution');
    formdata.append('Difficulty', 'Intermediate');
    formdata.append(
      'Description',
      'A tense conversation between a junior developer, User, and a senior developer, Jamie, over feedback on a code review.'
    );
    formdata.append('Mood', 'Supportive');
    formdata.append('video', wavBlobUrl);
    formdata.append('is_video', wavBlobUrl ? 'true' : 'false');

    const requestOptions: RequestInit = {
      method: 'POST',
      body: formdata,
      redirect: 'follow',
    };

    fetch('https://socialiq.zapto.org/generate_dialog_video', requestOptions)
      .then((response) => response.json())
      .then((result) => {
        console.log(result);
        setText('');
      })
      .catch((error) => console.error(error));
  };
  useEffect(() => {
    if (isRecordingStop && wavBlobUrl && text) {
      // get TIP   GET API
      fetchGetTips();
      // send audio or video to gpt post api
      fetchGenerateDialogVideo();
      // store_details POST API
      fetchStoreDetails();
    }
  }, [isRecordingStop, wavBlobUrl, text]);
  return (
    <>
      <section className="bg-[#e6e6e6]  mx-auto py-3 px-6   ">
        <div className="">
          <div className="flex  items-start lg:justify-between flex-col lg:flex-row  lg:items-center">
            <p className="text-center text-[#1c4f78] text-sm ">
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

            <div className="flex   lg:justify-between lg:items-center lg:justify-center gap-5  md:flex-row py-3">
              <div className="flex items-center gap-5">
                {timeUpdated ? (
                  <TimerComponent
                    onTimeUpdate={setTimeData}
                    botAndChat={time || botChat?.time}
                  />
                ) : (
                  <TimerComponent onTimeUpdate={setTimeData} />
                )}
              </div>
              <Link
                className="inline-block w-auto text-center  px-6 py-1 text-white transition-all rounded-md shadow-xl sm:w-auto bg-[#5c9bb6] hover:shadow-2xl hover:shadow-blue-400 hover:-tranneutral-y-px "
                to="#"
                onClick={addTimeChats}
              >
                Exit
              </Link>
              <Link
                className="inline-block w-auto text-center px-5 py-1 text-white transition-all bg-gray-700 bg-[#ff5252] dark:text-white rounded-md shadow-xl sm:w-auto  hover:text-white shadow-neutral-300  hover:shadow-2xl hover:shadow-neutral-400 hover:-tranneutral-y-px"
                to="#"
                onClick={() => setIsOpen(true)}
              >
                End The Session
              </Link>
            </div>
            <DeleteModel
              open={isOpen}
              setOpen={setIsOpen}
              DeleteChatStatus={DeleteChatStatus}
            />
          </div>
        </div>
        {/* <div className="grid grid-cols-1 sm:grid-cols-12 gap-5"> */}
        <div className="grid sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="sm:col-span-6  lg:col-span-7 xl:col-span-7  ">
            <div className="flex gap-5">
              <img
                src={imagess}
                className="rounded-2xl w-1/2 h-80 object-cover "
                style={{ borderWidth: 0, borderColor: 'blue' }}
              />
              <div>
                {/* Webcam feed display */}
                <div style={{ position: 'relative' }} className="w-full h-full">
                  {/* <h2>Webcam Feed</h2> */}
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    width="300"
                    height="400"
                    className="border w-full h-full shadow-md object-cover"
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
                        onClick={() => setIsCameraOn(!isCameraOn)}
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

            <div className="flex lg:justify-end  mt-5">
              <div className=" bg-[#e3f2fd] lg:w-[360px]  rounded-2xl p-5">
                <span>{getTips !== null && getTips.Tip}</span>
                <span className="block">
                  {getTips !== null && getTips.emoji}
                </span>
              </div>
            </div>
            {text && (
              <div>
                <h2>Base64 Audio & Video</h2>
              </div>
            )}
          </div>

          <div className="max-w-2xl flex justify-center sm:col-span-6 lg:col-span-5 xl:col-span-5">
            <div className="bg-white  h-[86vh] shadow-lg overflow-y-scroll   pb-10 border border-1 border-zinc-300 border-opacity-30 rounded-2xl relative overflow-hidden p-5">
              <div className="flex flex-col w-full gap-3">
                {botChat ? (
                  <>
                    <div className="flex justify-start gap-1">
                      <img
                        src={
                          botChat.avatarUrl ||
                          'https://www.tailwind-kit.com/images/object/10.png'
                        }
                        className="h-10 w-10 border border-[1px] border-zinc-300 border-opacity-50 rounded-full ml-3 opacity-90 "
                      />
                      <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-lg flex items-center px-2 py-2 text-white relative">
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
                            <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-lg flex items-center px-2 py-2 text-white relative text-sm">
                              {message}
                            </div>
                          </>
                        ) : (
                          <>
                            <img
                              src={
                                message.avatarUrl ||
                                'https://www.tailwind-kit.com/images/object/10.png'
                              }
                              className="h-10 w-10 border border-[1px] border-zinc-300 border-opacity-50 rounded-full mr-3 opacity-90"
                              alt="User avatar"
                            />
                            <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative text-sm">
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
                        <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative">
                          {/* {conversationItem.formatted.transcript ||
                            conversationItem.formatted.text ||
                            '(truncated)'} */}

                          {/* {text} */}

                          {!conversationItem.formatted.tool &&
                            conversationItem.role === 'user' && (
                              <div>
                                {conversationItem.formatted.transcript ||
                                  (conversationItem.formatted.audio?.length
                                    ? '(awaiting transcript)'
                                    : conversationItem.formatted.text ||
                                      '(item sent)')}
                              </div>
                            )}
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
                            <div className="w-1/2 bg-[#2196f3] border border-1 border-zinc-300 border-opacity-30 rounded-lg flex items-center px-2 py-2 text-white relative">
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
