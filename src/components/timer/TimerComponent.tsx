import React, { useEffect, useState } from 'react';

const TimerComponent = () => {
    const [seconds, setSeconds] = useState(0);
    const [minutes, setMinutes] = useState(0);
    const [hours, setHours] = useState(0);

    useEffect(() => {
        // Start an interval when the component mounts
        const interval = setInterval(() => {
            setSeconds((prevSeconds) => {
                if (prevSeconds === 59) {
                    setMinutes((prevMinutes) => {
                        if (prevMinutes === 59) {
                            setHours((prevHours) => prevHours + 1); // Increment hours when minutes reach 60
                        }
                        return (prevMinutes + 1) % 60; // Reset minutes after 60
                    });
                    return 0; // Reset seconds after 60
                }
                return prevSeconds + 1; // Increment seconds
            });
        }, 1000); // 1000 ms interval = 1 second

        // Cleanup interval when the component unmounts
        return () => clearInterval(interval);
    }, []);

    return (
        <div>

            <p className='font-bold'>
                Timer: {hours.toString().padStart(2, '0')}:{minutes.toString().padStart(2, '0')}:
                {seconds.toString().padStart(2, '0')}
            </p>

        </div>
    );
};

export default TimerComponent;
