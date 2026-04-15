import React, { createContext, useState, useEffect, useContext } from 'react';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { AuthContext } from './AuthContext';

export const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [hasGroupNotification, setHasGroupNotification] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const [localResetTime, setLocalResetTime] = useState(0);

  const resetNotifications = () => {
    setHasGroupNotification(false);
    setLocalResetTime(Date.now());
  };

  // 1. Monitor User's Last Seen Metadata
  useEffect(() => {
    if (!user) return;
    
    const userRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const serverTime = data.lastGroupsViewedAt?.toMillis() || 0;
        setLastSeen(serverTime);
        // Once server catches up or is newer than our local reset, we stop ignoring
        if (serverTime >= localResetTime) {
          setLocalResetTime(0);
        }
      }
    });

    return () => unsubUser();
  }, [user, localResetTime]);

  // 2. Monitor Group Activities
  useEffect(() => {
    if (!user) {
      setHasGroupNotification(false);
      return;
    }

    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', user.uid)
    );

    const unsubGroups = onSnapshot(q, (snapshot) => {
      const groups = snapshot.docs.map(d => d.data());
      
      const effectiveLastSeen = Math.max(lastSeen, localResetTime);
      
      const hasUpdate = groups.some(group => {
        const lastAct = group.lastActivityAt?.toMillis() || 0;
        // Increase buffer to 5s to account for slower sync/clocks
        return lastAct > (effectiveLastSeen + 5000);
      });

      setHasGroupNotification(hasUpdate);
    });

    return () => unsubGroups();
  }, [user, lastSeen, localResetTime]);

  return (
    <NotificationContext.Provider value={{ hasGroupNotification, resetNotifications }}>
      {children}
    </NotificationContext.Provider>
  );
};
