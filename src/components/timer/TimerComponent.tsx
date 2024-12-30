import moment from 'moment';
import React, { useEffect, useState } from 'react';

interface TimeData {
  hours: number;
  minutes: number;
  seconds: number;
}

interface TimerComponentProps {
  onTimeUpdate?: (timeData: TimeData) => void;
  botAndChat?: any;
}

const TimerComponent: React.FC<TimerComponentProps> = ({
  onTimeUpdate,
  botAndChat,
}) => {
  const [timerValue, setTimerValue] = useState<string | null>('');

  useEffect(() => {
    let interval: NodeJS.Timer;
    const startTime = moment(botAndChat || '00:00:00', 'HH:mm:ss');

    interval = setInterval(() => {
      startTime.add(1, 'seconds');
      const formattedTime = startTime.format('HH:mm:ss');
      setTimerValue(formattedTime);

      const timeParts = formattedTime.split(':').map(Number);
      const timeData: TimeData = {
        hours: timeParts[0],
        minutes: timeParts[1],
        seconds: timeParts[2],
      };

      if (onTimeUpdate) {
        onTimeUpdate(timeData);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [onTimeUpdate, botAndChat]);

  return (
    <div>
      <p className="font-bold">Timer: {timerValue}</p>
    </div>
  );
};

export default TimerComponent;
