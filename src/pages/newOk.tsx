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
import { instructions } from '../utils/conversation_config.js';

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

type SpeechRecognition = typeof window.SpeechRecognition | typeof window.webkitSpeechRecognition;

interface Window {
  SpeechRecognition?: SpeechRecognition;
  webkitSpeechRecognition?: SpeechRecognition;
}

let recognition: InstanceType<SpeechRecognition> | null = null;

let isSpeechRecognitionActive = false;


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
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);

  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState<any []>([]); 
  const [processedTranscript, setProcessedTranscript] = useState<
  { id: string; title: string }[]
>([]); // Processed array of objects

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
  const [emotion, setEmotion] = useState<any>('');
  const [timeUpdated, setTimeUpdated] = useState<boolean>(false);


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



   /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
   const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

     // Set state variables
     startTimeRef.current = new Date().toISOString();
     if (wavRecorder.getStatus() === 'recording') {
       setIsConnected(false);
       setRealtimeEvents([]);
       setItems(client.conversation.getItems());
     }
    
     

     try {

      // Check if the recorder is already recording
      if (wavRecorder.getStatus() === 'recording') {
        console.log('Recorder is already recording. Pausing first...');
        await wavRecorder.pause(); // Pause if already recording
      }


      // Begin recording if not started already
      await wavRecorder.begin();

      // Connect to audio output
      await wavStreamPlayer.connect();

      // Start recording
      console.log('Starting recording...');
      await wavRecorder.record((data) => 
          client.appendInputAudio(data.mono)
      );
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
      console.error('connectConversation error:', error);
      // Ensure proper cleanup on error
      try {
        if (wavRecorder.getStatus() !== 'ended') {
          console.log('Cleaning up recorder...');
          await wavRecorder.end();
        }
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
      setIsConnected(false); // Update state to reflect failure
      return; // Exit early due to error
    }


      // Build the dynamic instruction prompt
      const title = 'Negotiating a Salary Increase'; // Replace with dynamic value
      const category = 'Example Category'; // Replace with dynamic value
      const difficulty = 'Medium'; // Replace with dynamic value
      const description =
        'A recent graduate, user, is negotiating first job offer with the HR manager, Dan, who made an initial offer below users expected salary range.'; // Replace with dynamic value
      const mood = 'Friendly'; // Replace with dynamic value
      const user_name = 'User'; // Replace with dynamic value
      const previous_msg = 'This is a sample scenario';

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

        // Client connection logic (Placeholder)

      try {
        if (!client.isConnected()) {
          console.log('Attempting to connect RealtimeClient...');
          await client.connect();
          console.log('RealtimeClient connected successfully.');
        } else {
          console.log('RealtimeClient already connected.');
        }
      } catch (error) {
        console.error('Error connecting RealtimeClient:', error);
      }
      
      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: prompt,
        },
      ]);


  }, []);

 
  // Call the function when the component loads
  useEffect(() => {
    connectConversation();
    // if(!isConnected){
    // }
  }, [ ]);







  const startAudioVideoProcessing = async() => {
    const client = clientRef.current;

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: isCameraOn ? { facingMode: 'user' } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.pause(); // Pause before updating srcObject
        videoRef.current.srcObject = stream;
        await videoRef.current.play(); // Restart playback
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
      mediaRecorder.onstop = async () => {
        const mediaBlob = new Blob(videoChunksRef.current, { type: mimeType });

        const mediaUrl = URL.createObjectURL(mediaBlob);
        setMediaUrl(mediaUrl);

        if (!isCameraOn) {
          // Convert to WAV if needed
          console.log('Audio recording complete. Processing Audio Blob...');

          const wavBlob = await convertToWav(mediaBlob);
          const wavBlobUrl = URL.createObjectURL(wavBlob);

          setWavUrl(wavBlobUrl);
          setWavBlobUrl(wavBlob);

          // Cleanup the object URL after the download
          URL.revokeObjectURL(wavBlobUrl);
        } else {
          console.log('Video recording complete. Processing video Blob...');
          // You can trigger a video download here or send it to a server
          const videoBlobUrl = URL.createObjectURL(mediaBlob);
          // const wavVideo = await convertToWav(mediaBlob);
          setVideoBlobUrl(videoBlobUrl);
          setVideoBlob(mediaBlob);
          // Cleanup the video Blob URL
          URL.revokeObjectURL(videoBlobUrl);
        }

        videoChunksRef.current = [];
      };

      mediaRecorder.start();
      console.log('Recording started...');
      // startSpeechRecognition()

      // Monitor audio levels
      monitorAudioLevels(dataArray, stream);

    
      // client.createResponse();

      const wavRecorder = wavRecorderRef.current;
      if (wavRecorder.getStatus() === 'recording') {
        console.warn(
          'Already recording. Please pause or stop the current session first.'
        );
        return; // Prevent multiple recordings
      }

      try {
        await wavRecorder.record((data) => {
          client.appendInputAudio(data.mono);
        });
        setIsRecording(true);
        console.log('Recording started...');
      } catch (error) {
        console.error('Error starting recording:', error);
      }
    } catch (error) {
      console.error('Error accessing microphone or camera:', error);
    }
  };

  useEffect(() => {
    console.log('isCameraOn: ', isCameraOn);
    
    // if (isCameraOn) {
      startAudioVideoProcessing();
    // }
    return () => {
      // Clean up resources on unmount
      if (audioContextRef.current && isCameraOn && isMicOn) {
        audioContextRef.current.close();
      }
      if (streamRef.current && isCameraOn && isMicOn) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isCameraOn]);

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
          // startRecording();
          startSpeechRecognition()

        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        // silenceTimeoutRef.current = window.setTimeout(stopRecording, 2000); // Stop after 2 seconds of silence
        silenceTimeoutRef.current = window.setTimeout(stopSpeechRecognition, 2000); // Stop after 2 seconds of silence
      }

      requestAnimationFrame(detectSpeech);
    };

    detectSpeech();
  };

  const startSpeechRecognition = () => {
    if (recognition && !isSpeechRecognitionActive) {
      console.log("Starting speech recognition...");
      try {
        recognition.start();
        startRecording();
        setTranscript([]); // Clear previous transcript
      } catch (error) {
        console.error("Error starting speech recognition:",error);
      }
    } else {
      console.warn("Speech recognition already active or not initialized.");
    }
  };


  const startRecording = async () => {
    const wavRecorder = wavRecorderRef.current;
    const client = clientRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const mediaRecorder = mediaRecorderRef.current;
  
    // Interrupt the current stream
    try {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    } catch (error) {
      console.error('Error interrupting stream:', error);
    }
  
    // Start MediaRecorder if it's inactive
    if (mediaRecorder) {
      if (mediaRecorder.state === 'inactive') {
        mediaRecorder.start();
        console.log('MediaRecorder started.');
      } else if (mediaRecorder.state === 'recording') {
        console.warn('MediaRecorder is already recording.');
      }
    } else {
      console.warn('MediaRecorder is not available.');
    }
  
    setIsRecording(true);
  
    // Handle wavRecorder states
    try {
      if (wavRecorder) {
        if (wavRecorder.getStatus() === 'paused') {
          await wavRecorder.record((data) => client.appendInputAudio(data.mono));
        } else {
          await wavRecorder.begin();
          await wavRecorder.record((data) => client.appendInputAudio(data.mono));
        }
        console.log('wavRecorder started recording.');
      } else {
        console.warn('wavRecorder is not available.');
      }
    } catch (error) {
      console.error('Error during wavRecorder setup:', error);
    }
  };
  

  const stopSpeechRecognition = () => {
    if (recognition && isSpeechRecognitionActive) {
     
      try {
        console.log("Stopping speech recognition...");
        recognition.stop();
        stopRecording()
      } catch (error) {
        console.error("Error starting speech recognition:",error);
      }
    } else {
      console.warn("Speech recognition already active or not initialized.");
    }
  };

  const stopRecording = async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const mediaRecorder = mediaRecorderRef.current;
  
    try {
      // Pause wavRecorder
      if (wavRecorder) {
        await wavRecorder.pause();
      } else {
        console.warn('wavRecorder is not available.');
      }
  
      // Create client response
      if (client) {
        client.createResponse();
      } else {
        console.warn('Client is not available.');
      }
  
      // Stop MediaRecorder if it is recording
      if (mediaRecorder) {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          console.log('MediaRecorder stopped.');
        } else {
          console.warn('MediaRecorder is not recording.');
        }
      } else {
        console.warn('MediaRecorder is not available.');
      }
  
      // Update states
      setIsRecording(false);
      setIsRecordingStop(true);
    } catch (error) {
      console.error('Error during stopRecording:', error);
    }
  };
  



  useEffect(() => { 
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;
  
    // Set instructions
    client.updateSession({ instructions: instructions });
  
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1'} });
    
    client.on('error', (event: any) => console.error(event));
    
    client.on('conversation.interrupted', async () => {
      try {
        const trackSampleOffset = await wavStreamPlayer.interrupt();
        if (trackSampleOffset?.trackId) {
          const { trackId, offset } = trackSampleOffset;
          await client.cancelResponse(trackId, offset);
        }
      } catch (error) {
        console.error('Error handling interruption:', error);
      }
    });
  
    client.on('conversation.updated', async ({ item, delta }: any) => {
      try {
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
      } catch (error) {
        console.error('Error handling conversation update:', error);
      }
    });
  
    setItems(client.conversation.getItems()); 
  
    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);
  




  const startListening = useCallback(async () => {
    try {
      if (recognition) {
        await recognition.start();
        // setIsListening(true);

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          console.log('SpeechRecognition event:', event);
          const transcript = event.results[0][0].transcript;
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
    // await recognition.stop();
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
    if(transcript.length > 0){
      const allText = transcript.map((item, index) => ({
          id: `${index + 1}`,
          title: item
      }))
      setProcessedTranscript(allText);
    }
  }, [transcript])
  
  
    useEffect(() => {
      const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
  
    if (!SpeechRecognition) {
      console.error("Web Speech API is not supported in this browser.");
      return;
    }
  
      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;
  
      recognition.onstart = () => {
        isSpeechRecognitionActive = true;
        setIsListening(true);
        setTranscript([]); // Clear transcript when the mic starts listening
      };
  
      recognition.onresult = (event :any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript.trim() !== '') {
          setTranscript((prev) => {
            const updatedTranscript = [...prev, finalTranscript.trim()];
            return updatedTranscript;
          });
        }
        
        
      };
  
      recognition.onend = () => {
        isSpeechRecognitionActive = false;
        setIsListening(false);
        console.log("Speech recognition ended.");
      };
  
      recognition.onerror = (event :any) => {
        console.error("Speech recognition error:", event.error);
      };
  
      // Cleanup on unmount
      return () => {
        if (recognition) {
          recognition.onstart = null;
          recognition.onresult = null;
          recognition.onend = null;
          recognition.onerror = null;
        }
      };
    }, []);

  useEffect(() => {
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
  }, [isCameraOn]);

  const fetchChatApiSecondTime = async () => {
    const requestOptions: RequestInit = {
      method: 'GET',
      redirect: 'follow',
    };

    try {
      const response = await fetch(
        'https://socialiq.zapto.org/show_chat?email=developer.wellorgs@gmail.com&scenario_id=67287c99933445b37471fe71&user_name=testuser&bot_name=Kevin&delete=true',
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

  const DeleteChatStatus = () => {
    const formdata = new FormData();
    formdata.append('email', 'developer.wellorgs@gmail.com');
    formdata.append('scenario_id', '67287c99933445b37471fe71');

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
            setIsCameraOn(false);
            setIsMicOn(false);
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
              setIsCameraOn(false);
              setIsMicOn(false);
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
      })
      .catch((error) => console.error(error));
  };

  const fetchGenerateDialogVideo = () => {
    if (wavBlobUrl !== null || videoBlob !== null) {
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
      // formdata.append('video', wavBlobUrl);
      formdata.append('video', !isCameraOn ? wavBlobUrl : videoBlob);
      // formdata.append('video', isCameraOn ? mediaBlob : wavBlobUrl );
      // formdata.append('is_video', wavBlobUrl ? 'true' : 'false');
      formdata.append('is_video', isCameraOn ? 'true' : 'false');

      const requestOptions: RequestInit = {
        method: 'POST',
        body: formdata,
        redirect: 'follow',
      };

      fetch('https://socialiq.zapto.org/generate_dialog_video', requestOptions)
        .then((response) => response.json())
        .then((result) => {
          setText('');
          setEmotion(result);
          return result;
        })
        .catch((error) => console.error(error));
    }
  };

  useEffect(() => {
    if (isRecordingStop && text) {
      if (wavBlobUrl ?? videoBlob) {
        // get TIP   GET API
        fetchGetTips();
        // send audio or video to gpt post api
        fetchGenerateDialogVideo();
        // store_details POST API
        fetchStoreDetails();
      }
    }
  }, [isRecordingStop, wavBlobUrl, videoBlob, text, isCameraOn]);

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
                <div className="bg-yellow-500 text-white px-2 py-2">
                  {emotion?.audio_emotion}
                  {emotion?.video_emotion}
                </div>
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
                      {/* <audio autoPlay> */}
                      <audio muted>
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

              {/* {transcript} */}
              {/* {processedTranscript.map((trans, i) => {
                return (
                  <div className="" key={i}>
                    <div className={``}>
                    <div className="flex mb-4 justify-end gap-1 ">
                        <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative">{trans?.title}</div>
                      </div>
                      </div>
                      </div>
                )
              })} */}
                      
              

              {items.map((conversationItem, i) => {
                return (
                  <div className="" key={conversationItem.id}>
                    <div className={``}>
                    
                          <div className="flex mb-4 justify-end gap-1 ">
                        <div className="w-1/2 bg-[#eee] border border-1 border-zinc-300 border-opacity-30 rounded-md flex items-start px-2 py-2 text-black relative">
                        {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div>
                            {conversationItem.formatted.transcript ?? '--'}
                          </div>
                        )}</div>
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
