import React, { useEffect, useState } from 'react';

type SpeechRecognition = typeof window.SpeechRecognition | typeof window.webkitSpeechRecognition;

interface Window {
  SpeechRecognition?: SpeechRecognition;
  webkitSpeechRecognition?: SpeechRecognition;
}

let recognition: InstanceType<SpeechRecognition> | null = null;

let isSpeechRecognitionActive = false;

const Speech: React.FC = () => {
  const [transcript, setTranscript] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);

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
      setTranscript(''); // Clear transcript when the mic starts listening
      console.log("Speech recognition started.");
    };

    recognition.onresult = (event :any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript.trim() !== '') {
        setTranscript((prev) => prev + ' ' + finalTranscript);
        console.log("Final transcript:", finalTranscript);
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

  const startSpeechRecognition = () => {
    if (recognition && !isSpeechRecognitionActive) {
      console.log("Starting speech recognition...");
      setTranscript(''); // Clear previous transcript
      recognition.start();
    } else {
      console.warn("Speech recognition already active or not initialized.");
    }
  };

  const stopSpeechRecognition = () => {
    if (recognition && isSpeechRecognitionActive) {
      console.log("Stopping speech recognition...");
      recognition.stop();
    } else {
      console.warn("Speech recognition not active.");
    }
  };

  return (
    <div>
      <h1>Speech Recognition in React</h1>
      <button onClick={startSpeechRecognition} disabled={isListening } className='bg-green-500 text-white px-5'>
        Start Listening
      </button>
      <button onClick={stopSpeechRecognition} disabled={!isListening} className='bg-red-500 text-white'>
        Stop Listening
      </button>
      <div>
        <h2>Transcript:</h2>
        <p>{transcript}</p>
      </div>
    </div>
  );
};

export default Speech;
