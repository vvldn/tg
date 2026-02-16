import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';
import type {NearestTourResponse} from './types';
import LocatingScreen from './screens/LocatingScreen';
import TourReadyScreen from './screens/TourReadyScreen';
import ActiveTourScreen from './screens/ActiveTourScreen';
import TourEndedScreen from './screens/TourEndedScreen';

export type RootStackParamList = {
  Locating: undefined;
  TourReady: {nearestTour: NearestTourResponse};
  ActiveTour: {tourId: string; tourName: string};
  TourEnded: {
    summary: {
      duration_minutes: number;
      spots_visited: string[];
      interactions: number;
    };
  };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Locating"
      screenOptions={{
        headerShown: false,
        cardStyle: {backgroundColor: '#1A1A2E'},
      }}>
      <Stack.Screen name="Locating" component={LocatingScreen} />
      <Stack.Screen name="TourReady" component={TourReadyScreen} />
      <Stack.Screen name="ActiveTour" component={ActiveTourScreen} />
      <Stack.Screen name="TourEnded" component={TourEndedScreen} />
    </Stack.Navigator>
  );
}
